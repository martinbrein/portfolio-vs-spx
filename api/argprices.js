/**
 * Serverless function to fetch Argentine asset prices.
 * Supports:
 *  - Yahoo Finance for stocks/CEDEARs (.BA suffix)
 *  - CAFCI API for FCI funds
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { type, ticker, p1, p2, fondoId } = req.query

  try {
    if (type === 'stock') {
      // Yahoo Finance for BYMA stocks/CEDEARs
      const symbol = ticker.includes('.BA') ? ticker : `${ticker}.BA`
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const data = await resp.text()
      res.setHeader('Content-Type', 'application/json')
      return res.status(resp.status).send(data)
    }

    if (type === 'cafci') {
      // CAFCI API for FCI cuotapartes
      // fondoId is the CAFCI fund ID
      const url = `https://api.cafci.org.ar/fondo/${fondoId}/cuotaparte?d=${p1}&h=${p2}&limit=500`
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const data = await resp.text()
      res.setHeader('Content-Type', 'application/json')
      return res.status(resp.status).send(data)
    }

    if (type === 'cafci_search') {
      // Search fund by name
      const url = `https://api.cafci.org.ar/fondo?populate=*&limit=500`
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      const data = await resp.text()
      res.setHeader('Content-Type', 'application/json')
      return res.status(resp.status).send(data)
    }

    return res.status(400).json({ error: 'Unknown type. Use: stock, cafci, cafci_search' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
