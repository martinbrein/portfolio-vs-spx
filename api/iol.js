/**
 * Serverless proxy for Invertir Online (IOL) API.
 * Handles authentication and proxies historical price requests.
 *
 * Usage: GET /api/iol?ticker=GD35&from=2025-01-01&to=2026-03-16
 * Returns: array of { fechaHora, cierre, ultimo, ... } from IOL seriehistorica
 *
 * Env vars required: IOL_USER, IOL_PASS
 */

let cachedToken = null
let tokenExpiry = 0

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  const res = await fetch('https://api.invertironline.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(process.env.IOL_USER)}&password=${encodeURIComponent(process.env.IOL_PASS)}&grant_type=password`,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`IOL auth failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  // Expire 60s before real expiry to avoid edge cases
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { ticker, from, to } = req.query

  if (!ticker || !from || !to) {
    return res.status(400).json({ error: 'Missing params: ticker, from, to required' })
  }

  if (!process.env.IOL_USER || !process.env.IOL_PASS) {
    return res.status(500).json({ error: 'IOL credentials not configured (IOL_USER / IOL_PASS)' })
  }

  try {
    let token = await getToken()

    const url = `https://api.invertironline.com/api/v2/bCBA/Titulos/${encodeURIComponent(ticker)}/Cotizacion/seriehistorica/${from}/${to}/sinAjustar`

    let resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })

    // If 401, force token refresh and retry once
    if (resp.status === 401) {
      cachedToken = null
      tokenExpiry = 0
      token = await getToken()
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `IOL returned ${resp.status}` })
    }

    const data = await resp.text()
    res.setHeader('Content-Type', 'application/json')
    return res.status(200).send(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
