import { interpolatePrice } from './holdingsTracker'

/**
 * Generate all weekday dates (Mon–Fri) between two dates inclusive.
 */
function generateBusinessDays(startDate, endDate) {
  const dates = []
  const cur = new Date(startDate + 'T12:00:00Z')
  const end = new Date(endDate + 'T12:00:00Z')
  while (cur <= end) {
    const day = cur.getUTCDay()
    if (day !== 0 && day !== 6) {
      dates.push(cur.toISOString().split('T')[0])
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

/**
 * For each ticker, forward-fill market prices so every date in `dates`
 * has the most recent available price (avoids gaps on weekends/holidays).
 * Returns { ticker: { date: price } }
 */
function forwardFillPrices(marketPrices, dates) {
  const filled = {}
  for (const [ticker, prices] of Object.entries(marketPrices ?? {})) {
    const sortedPriceDates = Object.keys(prices).sort()
    filled[ticker] = {}
    let lastPrice = null
    for (const date of dates) {
      // Find latest price date <= this date
      const prior = sortedPriceDates.filter((d) => d <= date).at(-1)
      if (prior != null) lastPrice = prices[prior]
      if (lastPrice != null) filled[ticker][date] = lastPrice
    }
  }
  return filled
}

/**
 * Calculate portfolio value in USD on a given date.
 * - ARS cash → converted via MEP rate
 * - USD cash → direct
 * - Holdings → valued using filledMarketPrices (already forward-filled)
 *              falls back to knownPrices interpolation if no market price
 */
export function calcPortfolioValue(state, date, mepRate, filledMarketPrices, knownPrices) {
  if (!mepRate || mepRate <= 0) return null

  let totalARS = state.arsBalance ?? 0
  let totalUSD = state.usdBalance ?? 0
  let hasAllPrices = true

  for (const [ticker, qty] of Object.entries(state.holdings ?? {})) {
    if (qty <= 0) continue

    // Try forward-filled market price first, then interpolate from known op prices
    let priceARS = filledMarketPrices?.[ticker]?.[date]

    if (priceARS == null) {
      priceARS = interpolatePrice(ticker, date, knownPrices)
    }

    if (priceARS == null) {
      hasAllPrices = false
      continue
    }

    totalARS += qty * priceARS
  }

  const totalUSDValue = totalUSD + totalARS / mepRate
  return { value: totalUSDValue, hasAllPrices }
}

/**
 * Build a DAILY portfolio value series — one entry per business day.
 *
 * Key change vs previous version: instead of only valuing on operation dates,
 * we generate every weekday between start and end, carry-forward the last known
 * portfolio state, and price holdings using forward-filled market prices.
 * This gives the dense daily series needed for a proper SPX comparison.
 *
 * @returns {{ dailyValues: Array, netContributionsUSD: number }}
 *   dailyValues: [{ date, valueUSD, preECFValueUSD?, hasAllPrices }]
 */
export function buildDailyValues(stateByDate, mepRates, marketPrices, knownPrices, ecfEvents = []) {
  const opDates = Object.keys(stateByDate).sort()
  if (opDates.length === 0) return { dailyValues: [], netContributionsUSD: 0 }

  const startDate = opDates[0]
  const endDate = opDates.at(-1)

  // All business days in range
  const allDays = generateBusinessDays(startDate, endDate)

  // Forward-fill market prices onto every business day (O(n) per ticker, done once)
  const filledPrices = forwardFillPrices(marketPrices, allDays)

  // Forward-fill MEP rates
  const mepSorted = Object.keys(mepRates).sort()
  function getMEP(date) {
    const prior = mepSorted.filter((d) => d <= date).at(-1)
    return prior ? mepRates[prior] : null
  }

  // Group ECF events by date
  const ecfByDate = {}
  for (const ecf of ecfEvents) {
    if (!ecfByDate[ecf.date]) ecfByDate[ecf.date] = []
    ecfByDate[ecf.date].push(ecf)
  }

  const result = []
  let netContributionsUSD = 0
  let currentState = null

  for (const date of allDays) {
    // Update current portfolio state if there's an operation snapshot for this date
    if (stateByDate[date]) {
      currentState = stateByDate[date]
    }
    if (!currentState) continue

    const mepRate = getMEP(date)
    if (!mepRate) continue

    const calc = calcPortfolioValue(currentState, date, mepRate, filledPrices, knownPrices)
    if (!calc || calc.value == null) continue

    const { value, hasAllPrices } = calc

    // Compute pre-ECF value and accumulate net contributions for ECF dates
    let preECFValueUSD = null
    const ecfs = ecfByDate[date]
    if (ecfs && ecfs.length > 0) {
      let netFlowUSD = 0
      for (const ecf of ecfs) {
        const flowUSD = ecf.amountUSD + (mepRate > 0 ? ecf.amountARS / mepRate : 0)
        if (ecf.direction === 'IN') {
          netFlowUSD += flowUSD
          netContributionsUSD += flowUSD
        } else {
          netFlowUSD -= flowUSD
          netContributionsUSD -= flowUSD
        }
      }
      preECFValueUSD = value - netFlowUSD
    }

    result.push({ date, valueUSD: value, preECFValueUSD, hasAllPrices })
  }

  return { dailyValues: result, netContributionsUSD }
}

/**
 * Calculate Time Weighted Return using daily chain-linking.
 *
 * For each consecutive day pair (i-1 → i):
 *   - startValue = valueUSD[i-1]  (post-ECF if there was a flow that day)
 *   - endValue   = preECFValueUSD[i] if day i has a cash flow, else valueUSD[i]
 *     (using preECF removes the deposit/withdrawal distortion for that day's return)
 *
 * Daily return R_i = endValue / startValue - 1
 * Cumulative TWR = ∏(1 + R_i) - 1
 *
 * This gives a smooth, accurate curve that reflects actual daily price moves.
 *
 * @param {Array} dailyValues - [{date, valueUSD, preECFValueUSD?}] sorted by date
 * @param {Array} ecfEvents   - [{date, direction, amountARS, amountUSD}]
 * @returns {Array} [{date, twr}] — one entry per day in dailyValues
 */
export function calcTWR(dailyValues, ecfEvents) {
  if (!dailyValues || dailyValues.length < 2) return []

  const ecfDateSet = new Set(ecfEvents.map((e) => e.date))

  const result = []
  let cumulativeFactor = 1

  // Day 0 is always the baseline (TWR = 0%)
  result.push({ date: dailyValues[0].date, twr: 0 })

  for (let i = 1; i < dailyValues.length; i++) {
    const prev = dailyValues[i - 1]
    const curr = dailyValues[i]

    // Start of this day's sub-period: post-ECF value from yesterday
    const startValue = prev.valueUSD

    // End of this day's sub-period:
    //   - If today has a cash flow → use preECFValue (performance before the flow)
    //   - Otherwise → use plain daily value
    const endValue = (ecfDateSet.has(curr.date) && curr.preECFValueUSD != null)
      ? curr.preECFValueUSD
      : curr.valueUSD

    if (startValue > 0 && endValue != null) {
      cumulativeFactor *= endValue / startValue
    }

    result.push({ date: curr.date, twr: (cumulativeFactor - 1) * 100 })
  }

  return result
}
