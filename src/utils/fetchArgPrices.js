function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

/**
 * Fetch historical prices via IOL API (primary source for all BYMA instruments)
 * @returns {{ date: price }} — uses cierre (close), falls back to ultimo (last)
 */
async function fetchIOLPrices(ticker, startDate, endDate) {
  try {
    const res = await withTimeout(
      fetch(`/api/iol?ticker=${encodeURIComponent(ticker)}&from=${startDate}&to=${endDate}`),
      15000
    )
    if (!res.ok) return {}
    const json = await res.json()
    if (!Array.isArray(json) || json.length === 0) return {}

    const prices = {}
    for (const item of json) {
      const date = item.fechaHora?.split('T')[0]
      const price = item.cierre ?? item.ultimo ?? null
      if (date && price != null && price > 0) prices[date] = price
    }
    return prices
  } catch {
    return {}
  }
}

/**
 * Fetch historical prices via Yahoo Finance (.BA suffix)
 * @returns {{ prices: object, quoteType: string|null }}
 */
async function fetchYahooPrices(ticker, startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000)
  const end = new Date(endDate)
  end.setDate(end.getDate() + 3)
  const p2 = Math.floor(end.getTime() / 1000)

  try {
    const res = await withTimeout(
      fetch(`/api/argprices?type=stock&ticker=${ticker}&p1=${p1}&p2=${p2}`),
      10000
    )
    if (!res.ok) return { prices: {}, quoteType: null }
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return { prices: {}, quoteType: null }

    const quoteType = result.meta?.quoteType ?? null

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
    return { prices, quoteType }
  } catch {
    return { prices: {}, quoteType: null }
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
 * Fetch prices for a single ticker.
 *
 * Source priority:
 *  1. IOL API  (primary — all BYMA instruments)
 *  2. Yahoo Finance (.BA) — fallback
 *  3. CAFCI — for FCI funds only
 *
 * Bond pricing: IOL and Yahoo both quote bonds as % of par (e.g. 67.0 for GD35).
 * When isBond=true, divide by 100 to get price per nominal unit.
 */
export async function fetchTickerPrices(ticker, startDate, endDate, isBond = false) {
  // 1. Try IOL (primary)
  const iolRaw = await fetchIOLPrices(ticker, startDate, endDate)
  if (Object.keys(iolRaw).length > 0) {
    const prices = isBond
      ? Object.fromEntries(Object.entries(iolRaw).map(([d, p]) => [d, p / 100]))
      : iolRaw
    return { prices, source: 'iol' }
  }

  // 2. Try Yahoo Finance (fallback)
  const { prices: yahooPrices } = await fetchYahooPrices(ticker, startDate, endDate)
  if (Object.keys(yahooPrices).length > 0) {
    const prices = isBond
      ? Object.fromEntries(Object.entries(yahooPrices).map(([d, p]) => [d, p / 100]))
      : yahooPrices
    return { prices, source: 'yahoo' }
  }

  // 3. Try CAFCI (FCI funds)
  const fciPrices = await fetchFCIPrices(ticker, startDate, endDate)
  if (Object.keys(fciPrices).length > 0) return { prices: fciPrices, source: 'cafci' }

  return { prices: {}, source: 'none' }
}

/**
 * Fetch prices for all tickers in parallel
 */
export async function fetchAllPrices(tickers, startDate, endDate, onProgress, bondTickers = new Set()) {
  const marketPrices = {} // { ticker: { date: priceARS } }
  const priceSources = {} // { ticker: 'iol' | 'yahoo' | 'cafci' | 'none' }

  await Promise.allSettled(
    tickers.map(async (ticker) => {
      const { prices, source } = await fetchTickerPrices(ticker, startDate, endDate, bondTickers.has(ticker))
      marketPrices[ticker] = prices
      priceSources[ticker] = source
      onProgress?.()
    })
  )

  return { marketPrices, priceSources }
}
