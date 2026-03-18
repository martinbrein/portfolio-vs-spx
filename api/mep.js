/**
 * Serverless function to fetch historical MEP (dólar bolsa) rates.
 *
 * Sources (tried in order):
 *  1. IOL API — AL30 (ARS) / AL30D (USD) closing prices → MEP = AL30_ARS / AL30D_USD
 *  2. ArgentinaDatos API — historical dólar bolsa series
 *  3. BCRA estadisticasbcra.com — full historical series
 *
 * Returns: [{ fecha: "YYYY-MM-DD", venta: number }, ...]
 */

// Token cache for IOL (independent of api/iol.js which runs in its own module)
let cachedToken = null
let tokenExpiry = 0

async function getIOLToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken
  const res = await fetch('https://api.invertironline.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(process.env.IOL_USER)}&password=${encodeURIComponent(process.env.IOL_PASS)}&grant_type=password`,
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`IOL auth failed (${res.status})`)
  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

/**
 * Fetch IOL seriehistorica for a ticker and return { date: closePrice }.
 * Prices are returned as-is (% of par for bonds).
 */
async function fetchIOLSeries(ticker, from, to, token) {
  const url = `https://api.invertironline.com/api/v2/bCBA/Titulos/${encodeURIComponent(ticker)}/Cotizacion/seriehistorica/${from}/${to}/sinAjustar`
  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  if (resp.status === 401) {
    // Force token refresh once
    cachedToken = null; tokenExpiry = 0
    const newToken = await getIOLToken()
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${newToken}` },
      signal: AbortSignal.timeout(10000),
    })
  }
  if (!resp.ok) throw new Error(`IOL ${ticker} returned ${resp.status}`)
  const data = await resp.json()
  if (!Array.isArray(data)) return {}
  const prices = {}
  for (const item of data) {
    const date = item.fechaHora?.split('T')[0]
    const price = item.cierre ?? item.ultimo ?? null
    if (date && price != null && price > 0 && !prices[date]) {
      prices[date] = price
    }
  }
  return prices
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { startDate, endDate } = req.query

  // ── 1. IOL: MEP = AL30_ARS / AL30D_USD ──────────────────────────────────
  if (process.env.IOL_USER && process.env.IOL_PASS) {
    try {
      const token = await getIOLToken()
      const [al30, al30d] = await Promise.all([
        fetchIOLSeries('AL30',  startDate, endDate, token),
        fetchIOLSeries('AL30D', startDate, endDate, token),
      ])

      const dates = [...new Set([...Object.keys(al30), ...Object.keys(al30d)])].sort()
      const rates = []
      let lastAL30 = null, lastAL30D = null

      for (const date of dates) {
        if (al30[date]  != null) lastAL30  = al30[date]
        if (al30d[date] != null) lastAL30D = al30d[date]
        if (lastAL30 && lastAL30D && lastAL30D > 0) {
          rates.push({ fecha: date, venta: Math.round((lastAL30 / lastAL30D) * 100) / 100 })
        }
      }

      if (rates.length > 0) {
        return res.status(200).json(rates)
      }
    } catch (_) {}
  }

  // ── 2. ArgentinaDatos ────────────────────────────────────────────────────
  try {
    const url = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa'
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (resp.ok) {
      const data = await resp.json()
      const arr = Array.isArray(data) ? data : data?.data ?? []
      const filtered = arr.filter((d) => {
        const date = d.fecha ?? d.date ?? d.d
        return date >= startDate && date <= endDate
      })
      if (filtered.length > 0) {
        return res.status(200).json(
          filtered.map((d) => ({
            fecha: d.fecha ?? d.date ?? d.d,
            venta: parseFloat(d.venta ?? d.compra ?? d.v ?? 0),
          }))
        )
      }
    }
  } catch (_) {}

  // ── 3. BCRA estadisticasbcra.com ─────────────────────────────────────────
  try {
    const resp = await fetch('https://api.estadisticasbcra.com/mep', {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) {
      const data = await resp.json()
      const filtered = data.filter((d) => d.d >= startDate && d.d <= endDate)
      if (filtered.length > 0) {
        return res.status(200).json(filtered.map((d) => ({ fecha: d.d, venta: d.v })))
      }
    }
  } catch (_) {}

  return res.status(503).json({ error: 'Could not fetch MEP rate from any source' })
}
