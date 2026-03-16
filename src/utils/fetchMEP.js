function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

/**
 * Fetch historical MEP (dólar bolsa) rates.
 * Returns { date: mepRate } where mepRate is ARS per USD.
 */
export async function fetchMEPRates(startDate, endDate) {
  // Try serverless function
  try {
    const res = await withTimeout(
      fetch(`/api/mep?startDate=${startDate}&endDate=${endDate}`),
      10000
    )
    if (res.ok) {
      const data = await res.json()
      return parseMEPResponse(data)
    }
  } catch {}

  // Fallback: use estadisticasbcra via CORS proxy
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent('https://api.estadisticasbcra.com/mep')}`,
    `https://corsproxy.io/?${encodeURIComponent('https://api.estadisticasbcra.com/mep')}`,
  ]

  for (const proxyUrl of proxies) {
    try {
      const res = await withTimeout(fetch(proxyUrl), 15000)
      if (!res.ok) continue
      const data = await res.json()
      const filtered = data.filter((d) => d.d >= startDate && d.d <= endDate)
      const rates = {}
      for (const item of filtered) {
        rates[item.d] = item.v
      }
      if (Object.keys(rates).length > 0) return rates
    } catch {}
  }

  // Last resort: return empty (will use interpolation from operations)
  return {}
}

function parseMEPResponse(data) {
  const rates = {}
  const arr = Array.isArray(data) ? data : data?.data ?? []

  for (const item of arr) {
    const date = item.fecha ?? item.date ?? item.d
    const rate = parseFloat(item.venta ?? item.valor ?? item.v ?? item.mep ?? 0)
    if (date && rate > 0) rates[date] = rate
  }
  return rates
}

/**
 * Forward-fill MEP rates for all dates in range
 * (MEP doesn't exist on weekends/holidays)
 */
export function fillMEPRates(rates, dates) {
  const sorted = Object.keys(rates).sort()
  const result = {}
  let last = null

  for (const date of dates.sort()) {
    const exact = rates[date]
    if (exact) {
      last = exact
    } else {
      // Find most recent rate
      const before = sorted.filter((d) => d <= date)
      if (before.length > 0 && !last) last = rates[before.at(-1)]
    }
    if (last) result[date] = last
  }
  return result
}
