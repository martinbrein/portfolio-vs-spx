function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

/**
 * Fetch historical prices for Argentine stocks/CEDEARs via Yahoo Finance (.BA)
 * @returns {object} { date: priceARS }
 */
export async function fetchStockPrices(ticker, startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000)
  const end = new Date(endDate)
  end.setDate(end.getDate() + 3)
  const p2 = Math.floor(end.getTime() / 1000)

  try {
    const res = await withTimeout(
      fetch(`/api/argprices?type=stock&ticker=${ticker}&p1=${p1}&p2=${p2}`),
      10000
    )
    if (!res.ok) return {}
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return {}

    const timestamps = result.timestamp ?? []
    const closes =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ??
      []

    const prices = {}
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0]
        prices[date] = closes[i]
      }
    }
    return prices
  } catch {
    return {}
  }
}

/**
 * Search CAFCI fund by name (fuzzy match)
 * @returns {string|null} fondoId
 */
let cafciCache = null
export async function findCAFCIFundId(fundName) {
  try {
    if (!cafciCache) {
      const res = await withTimeout(fetch('/api/argprices?type=cafci_search'), 10000)
      if (!res.ok) return null
      cafciCache = await res.json()
    }

    const name = fundName.toLowerCase().replace(/[^a-z0-9\s]/g, '')
    const funds = cafciCache?.data ?? cafciCache ?? []
    const match = funds.find((f) => {
      const fname = (f.nombre ?? f.name ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '')
      return fname.includes(name.slice(0, 10)) || name.includes(fname.slice(0, 10))
    })
    return match?.id ?? null
  } catch {
    return null
  }
}

/**
 * Fetch FCI cuotaparte history from CAFCI
 * @returns {object} { date: priceARS }
 */
export async function fetchFCIPrices(ticker, startDate, endDate) {
  try {
    const fondoId = await findCAFCIFundId(ticker)
    if (!fondoId) return {}

    const res = await withTimeout(
      fetch(`/api/argprices?type=cafci&fondoId=${fondoId}&p1=${startDate}&p2=${endDate}`),
      10000
    )
    if (!res.ok) return {}
    const json = await res.json()
    const records = json?.data ?? json ?? []

    const prices = {}
    for (const r of records) {
      const date = r.fecha ?? r.date ?? r.d
      const price = parseFloat(r.valor ?? r.value ?? r.v ?? 0)
      if (date && price > 0) prices[date] = price
    }
    return prices
  } catch {
    return {}
  }
}

/**
 * Classify a ticker and fetch its prices.
 * Returns { date: priceARS } map.
 */
export async function fetchTickerPrices(ticker, startDate, endDate) {
  // Try stock (Yahoo Finance .BA) first
  const stockPrices = await fetchStockPrices(ticker, startDate, endDate)
  if (Object.keys(stockPrices).length > 0) return { prices: stockPrices, source: 'yahoo' }

  // Try CAFCI (for FCI funds)
  const fciPrices = await fetchFCIPrices(ticker, startDate, endDate)
  if (Object.keys(fciPrices).length > 0) return { prices: fciPrices, source: 'cafci' }

  return { prices: {}, source: 'none' }
}

/**
 * Fetch prices for all tickers in parallel
 */
export async function fetchAllPrices(tickers, startDate, endDate, onProgress) {
  const marketPrices = {} // { ticker: { date: priceARS } }
  const priceSources = {} // { ticker: 'yahoo' | 'cafci' | 'interpolated' | 'none' }

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const { prices, source } = await fetchTickerPrices(ticker, startDate, endDate)
      marketPrices[ticker] = prices
      priceSources[ticker] = source
      onProgress?.()
    })
  )

  return { marketPrices, priceSources }
}
