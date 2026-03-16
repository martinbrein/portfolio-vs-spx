/**
 * Serverless function to fetch historical MEP (dólar bolsa) rates.
 * Primary: dolarapi.com
 * Fallback: ambito.com scraping
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { startDate, endDate } = req.query

  try {
    // dolarapi.com provides historical MEP rates
    const url = `https://api.dolarapi.com/v1/cotizaciones/mep?desde=${startDate}&hasta=${endDate}`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    })

    if (resp.ok) {
      const data = await resp.text()
      res.setHeader('Content-Type', 'application/json')
      return res.status(200).send(data)
    }

    // Fallback: BCRA via estadisticasbcra.com (uses MEP = dólar bolsa)
    const fallbackUrl = `https://api.estadisticasbcra.com/mep`
    const fallbackResp = await fetch(fallbackUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    })

    if (fallbackResp.ok) {
      const data = await fallbackResp.json()
      // Filter by date range
      const filtered = data.filter((d) => d.d >= startDate && d.d <= endDate)
      return res.status(200).json(filtered.map((d) => ({ date: d.d, mep: d.v })))
    }

    return res.status(503).json({ error: 'Could not fetch MEP rate from any source' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
