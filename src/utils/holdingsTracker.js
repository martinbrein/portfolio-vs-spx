/**
 * Processes operations chronologically and builds:
 * - Daily portfolio state (cash ARS, cash USD, holdings {ticker: qty})
 * - List of known prices from operations (for bond interpolation)
 * - List of ECF events with dates
 */


export function buildPortfolioState(ops, mepRatesFromOps = {}) {
  // Filter out ignored ops, sort by settlement date (or trade date).
  // When two ops share the same settlement date, process buys before sells so
  // that Math.max(0, ...) clamping never zeroes out a position that was
  // simultaneously opened and closed on the same day (e.g. AL30 MEP operation).
  const typeOrder = (op) =>
    op.type === 'COMPRA' || op.type === 'SUSCRIPCION' ? 0 : 1
  const active = ops
    .filter((op) => op.type !== 'IGNORAR')
    .sort((a, b) => {
      const dateA = a.settlementDate || a.date
      const dateB = b.settlementDate || b.date
      const dateCmp = dateA.localeCompare(dateB)
      if (dateCmp !== 0) return dateCmp
      return typeOrder(a) - typeOrder(b)
    })

  // Helper: look up closest MEP rate on or before a given date
  const mepDates = Object.keys(mepRatesFromOps).sort()
  function lookupMEP(date) {
    const prior = mepDates.filter((d) => d <= date).at(-1)
    return prior ? mepRatesFromOps[prior] : null
  }

  let arsBalance = 0
  let usdBalance = 0
  const holdings = {} // { ticker: quantity }
  const knownPrices = {} // { ticker: [{date, price}] }
  const ecfEvents = [] // External cash flows
  const stateByDate = {} // { date: { arsBalance, usdBalance, holdings clone, ecf } }
  const bondTickers = new Set() // tickers identified as renta fija

  for (const op of active) {
    const useDate = op.settlementDate || op.date
    const importe = op.importeNeto ?? 0
    const qty = op.valorNominal ?? 0
    const price = op.precio

    const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'

    // Record known price from the operation — always store in ARS, per nominal unit.
    // For ARS instruments use |importeNeto|/|qty| rather than precio: bonds are quoted
    // as % of par in the XLS (e.g. 97.5), so precio ≠ per-unit ARS.
    // importeNeto / qty gives the true per-unit price for both bonds and stocks.
    if (op.ticker && price && price > 0) {
      let arsPrice
      const absQty = Math.abs(qty)
      const absAmt = Math.abs(op.importeNeto ?? 0)
      if (!isUSD) {
        // ARS instrument: derive from importeNeto to handle % of par bonds correctly
        arsPrice = (absQty > 0 && absAmt > 0) ? absAmt / absQty : price
      }
      if (isUSD) {
        const tc = op.tipoCambio > 1 ? op.tipoCambio : (lookupMEP(op.date) ?? 1)

        const isPrimaryMarket = /COMPRACPRM/i.test(op.detalle ?? '')
        if (isPrimaryMarket && op.ticker) bondTickers.add(op.ticker)

        // Primary: use actual traded amounts to get true per-unit USD price × TC.
        // This avoids the price/100 heuristic that incorrectly divides high-price
        // stocks (e.g. MELI CEDEAR at $700/share) the same way as bonds (AL30 at 67%).
        if (absQty > 0 && absAmt > 0) {
          const usdPerUnit = absAmt / absQty
          arsPrice = usdPerUnit * tc
          // Bond detection: sovereign/corporate bonds have unit values < $5
          // (par = $1 per VN, max reasonable price ~200% = $2/VN).
          // High-price stocks/CEDEARs are always well above $5/share.
          if (!isPrimaryMarket && price >= 5 && usdPerUnit < 5) {
            bondTickers.add(op.ticker)
          }
        } else if (price < 5 || isPrimaryMarket) {
          // FCI / at-par / primary market
          arsPrice = price * tc
        } else {
          // Fallback: assume % of par bond
          arsPrice = (price / 100) * tc
          bondTickers.add(op.ticker)
        }
      }
      if (!knownPrices[op.ticker]) knownPrices[op.ticker] = []
      knownPrices[op.ticker].push({ date: op.date, price: arsPrice })
    }

    // Mark as bond when we see income/repayment events
    if (op.ticker && (op.type === 'CUPON' || op.type === 'AMORTIZACION')) {
      bondTickers.add(op.ticker)
    }

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
    bondTickers,        // Set of tickers identified as renta fija
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
