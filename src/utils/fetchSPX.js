function fetchWithTimeout(url, ms) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id))
}

export async function fetchSPXData(startDate, endDate) {
  const p1 = Math.floor(new Date(startDate).getTime() / 1000)
  const end = new Date(endDate)
  end.setDate(end.getDate() + 5)
  const p2 = Math.floor(end.getTime() / 1000)

  // 1. Try Vercel serverless function (works in production)
  try {
    const res = await fetchWithTimeout(`/api/spx?p1=${p1}&p2=${p2}`, 10000)
    if (res.ok) {
      const json = await res.json()
      if (json?.chart?.result?.[0]) return parseYahooResponse(json)
    }
  } catch (_) {
    // Falls through to CORS proxy fallback (local dev)
  }

  // 2. Fallback: CORS proxies for local development
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${p1}&period2=${p2}&interval=1d&events=history`
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(yahooUrl)}`,
  ]

  for (const proxyUrl of proxies) {
    try {
      const res = await fetchWithTimeout(proxyUrl, 20000)
      if (!res.ok) continue
      const json = JSON.parse(await res.text())
      if (json?.chart?.result?.[0]) return parseYahooResponse(json)
    } catch (_) {
      continue
    }
  }

  throw new Error('No se pudo obtener datos del S&P 500. Verificá tu conexión a internet.')
}

function parseYahooResponse(json) {
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
