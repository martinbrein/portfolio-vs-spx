export default async function handler(req, res) {
  const { p1, p2 } = req.query
  if (!p1 || !p2) {
    return res.status(400).json({ error: 'Missing p1 or p2 params' })
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${p1}&period2=${p2}&interval=1d&events=history`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    })
    const data = await response.text()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    res.status(response.status).send(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
