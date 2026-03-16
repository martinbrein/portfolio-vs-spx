/**
 * Processes operations chronologically and builds:
 * - Daily portfolio state (cash ARS, cash USD, holdings {ticker: qty})
 * - List of known prices from operations (for bond interpolation)
 * - List of ECF events with dates
 */

export function buildPortfolioState(ops) {
  // Filter out ignored ops, sort by settlement date (or trade date)
  const active = ops
    .filter((op) => op.type !== 'IGNORAR')
    .sort((a, b) => (a.settlementDate || a.date).localeCompare(b.settlementDate || b.date))

  let arsBalance = 0
  let usdBalance = 0
  const holdings = {} // { ticker: quantity }
  const knownPrices = {} // { ticker: [{date, price}] }
  const ecfEvents = [] // External cash flows
  const stateByDate = {} // { date: { arsBalance, usdBalance, holdings clone, ecf } }

  for (const op of active) {
    const useDate = op.settlementDate || op.date
    const importe = op.importeNeto ?? 0
    const qty = op.valorNominal ?? 0
    const price = op.precio

    // Record known price from the operation
    if (op.ticker && price && price > 0) {
      if (!knownPrices[op.ticker]) knownPrices[op.ticker] = []
      knownPrices[op.ticker].push({ date: op.date, price })
    }

    const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'

    switch (op.type) {
      case 'COMPRA':
      case 'SUSCRIPCION':
        if (isUSD) usdBalance += importe
        else arsBalance += importe // importe is negative (paid)
        if (op.ticker) holdings[op.ticker] = (holdings[op.ticker] ?? 0) + Math.abs(qty)
        break

      case 'VENTA':
      case 'RESCATE':
        if (isUSD) usdBalance += importe
        else arsBalance += importe // importe is positive (received)
        if (op.ticker) holdings[op.ticker] = Math.max(0, (holdings[op.ticker] ?? 0) - Math.abs(qty))
        break

      case 'CAUCION':
        // Caución bursátil: pure cash in/out, no security holding
        if (isUSD) usdBalance += importe
        else arsBalance += importe
        break

      case 'DIVIDENDO':
      case 'CUPON':
      case 'AMORTIZACION':
        if (isUSD) usdBalance += importe
        else arsBalance += importe
        if (op.type === 'AMORTIZACION' && op.ticker) {
          // Partial repayment reduces nominal holding
          holdings[op.ticker] = Math.max(0, (holdings[op.ticker] ?? 0) - Math.abs(qty))
        }
        break

      case 'SPLIT':
        // qty here is the NEW quantity after split (or ratio — parse from detalle if possible)
        // For now, apply the ratio from valor nominal if available
        if (op.ticker && qty) {
          const prev = holdings[op.ticker] ?? 0
          if (prev > 0 && qty > 0) {
            holdings[op.ticker] = qty // Replace with post-split qty
          }
        }
        break

      case 'DEPOSITO':
        if (isUSD) usdBalance += Math.abs(importe)
        else arsBalance += Math.abs(importe)
        ecfEvents.push({ date: useDate, amountARS: isUSD ? 0 : Math.abs(importe), amountUSD: isUSD ? Math.abs(importe) : 0, direction: 'IN' })
        break

      case 'RETIRO':
        if (isUSD) usdBalance -= Math.abs(importe)
        else arsBalance -= Math.abs(importe)
        ecfEvents.push({ date: useDate, amountARS: isUSD ? 0 : Math.abs(importe), amountUSD: isUSD ? Math.abs(importe) : 0, direction: 'OUT' })
        break

      case 'TRANSFER_TIT':
        if (op.ecfDirection === 'IN') {
          if (isUSD) usdBalance += Math.abs(importe)
          else arsBalance += Math.abs(importe)
        } else {
          if (isUSD) usdBalance -= Math.abs(importe)
          else arsBalance -= Math.abs(importe)
        }
        ecfEvents.push({ date: useDate, amountARS: isUSD ? 0 : Math.abs(importe), amountUSD: isUSD ? Math.abs(importe) : 0, direction: op.ecfDirection })
        break

      default:
        break
    }

    // Snapshot state after this operation
    stateByDate[useDate] = {
      date: useDate,
      arsBalance,
      usdBalance,
      holdings: { ...holdings },
    }
  }

  // Get unique tickers with non-zero holdings at end
  const finalHoldings = Object.entries(holdings)
    .filter(([, qty]) => qty > 0)
    .map(([ticker, qty]) => ({ ticker, qty }))

  return {
    stateByDate,        // daily snapshots
    finalHoldings,      // current holdings
    knownPrices,        // {ticker: [{date, price}]}
    ecfEvents,          // [{date, amountARS, amountUSD, direction}]
    finalARS: arsBalance,
    finalUSD: usdBalance,
  }
}

/**
 * Get all unique tickers that appear in operations
 */
export function extractTickers(ops) {
  const tickers = new Set()
  for (const op of ops) {
    if (op.ticker && op.type !== 'IGNORAR' && op.type !== 'OTRO') {
      tickers.add(op.ticker)
    }
  }
  return [...tickers]
}

/**
 * Interpolate price for a ticker on a given date using known prices
 */
export function interpolatePrice(ticker, date, knownPrices) {
  const prices = knownPrices[ticker]
  if (!prices || prices.length === 0) return null

  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date))

  // Exact match
  const exact = sorted.find((p) => p.date === date)
  if (exact) return exact.price

  // Find surrounding points
  const before = sorted.filter((p) => p.date <= date)
  const after = sorted.filter((p) => p.date > date)

  if (before.length === 0) return after[0]?.price ?? null
  if (after.length === 0) return before.at(-1)?.price ?? null

  // Linear interpolation
  const p0 = before.at(-1)
  const p1 = after[0]
  const t0 = new Date(p0.date).getTime()
  const t1 = new Date(p1.date).getTime()
  const t = new Date(date).getTime()
  const ratio = (t - t0) / (t1 - t0)
  return p0.price + ratio * (p1.price - p0.price)
}
