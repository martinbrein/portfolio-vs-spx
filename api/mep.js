/**
 * Serverless function to fetch historical MEP (dólar bolsa) rates.
 * Sources (tried in order):
 *  1. ArgentinaDatos API  — reliable historical dólar bolsa series
 *  2. BCRA estadisticasbcra.com — full historical series
 *  3. dolarapi.com — current/recent rates as last resort
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { startDate, endDate } = req.query

  // ── 1. ArgentinaDatos ────────────────────────────────────────────────────
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
        const rates = filtered.map((d) => ({
          fecha: d.fecha ?? d.date ?? d.d,
          venta: parseFloat(d.venta ?? d.compra ?? d.v ?? 0),
        }))
        return res.status(200).json(rates)
      }
    }
  } catch (_) {}

  // ── 2. BCRA estadisticasbcra.com ─────────────────────────────────────────
  try {
    const fallbackUrl = 'https://api.estadisticasbcra.com/mep'
    const fallbackResp = await fetch(fallbackUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (fallbackResp.ok) {
      const data = await fallbackResp.json()
      const filtered = data.filter((d) => d.d >= startDate && d.d <= endDate)
      if (filtered.length > 0) {
        return res.status(200).json(filtered.map((d) => ({ fecha: d.d, venta: d.v })))
      }
    }
  } catch (_) {}

  // ── 3. dolarapi.com (current only, may not have full history) ────────────
  try {
    const url = `https://api.dolarapi.com/v1/cotizaciones/mep?desde=${startDate}&hasta=${endDate}`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (resp.ok) {
      const data = await resp.text()
      res.setHeader('Content-Type', 'application/json')
      return res.status(200).send(data)
    }
  } catch (_) {}

  return res.status(503).json({ error: 'Could not fetch MEP rate from any source' })
}
