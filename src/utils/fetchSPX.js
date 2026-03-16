export async function fetchSPXData(startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000)
  const end = new Date(endDate)
  end.setDate(end.getDate() + 5)
  const p2 = Math.floor(end.getTime() / 1000)

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${p1}&period2=${p2}&interval=1d&events=history`

  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
  ]

  let json = null
  let lastErr = null

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue
      const text = await res.text()
      json = JSON.parse(text)
      if (json?.chart?.result?.[0]) break
      json = null
    } catch (e) {
      lastErr = e
    }
  }

  if (!json?.chart?.result?.[0]) {
    throw new Error(lastErr?.message || 'No se pudo obtener datos del S&P 500. Verificá tu conexión.')
  }

  const result = json.chart.result[0]
  const timestamps = result.timestamp || []
  const closes =
    result.indicators?.adjclose?.[0]?.adjclose ||
    result.indicators?.quote?.[0]?.close ||
    []

  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      value: closes[i],
    }))
    .filter((d) => d.value != null && !isNaN(d.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}
