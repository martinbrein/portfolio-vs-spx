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
 * Calculate Time Weighted Return.
 *
 * Each sub-period: [ECF_date_i, ECF_date_{i+1}]
 *   R_i = V_pre_ECF(end) / V_post_ECF(start) - 1
 *
 * V_pre_ECF eliminates the distortion caused by cash inflows/outflows.
 *
 * @param {Array} dailyValues - [{date, valueUSD, preECFValueUSD?}] sorted by date
 * @param {Array} ecfEvents   - [{date, direction, amountARS, amountUSD}]
 * @returns {Array} [{date, twr}] — one entry per day in dailyValues
 */
export function calcTWR(dailyValues, ecfEvents) {
  if (!dailyValues || dailyValues.length < 2) return []

  const valueMap = {}   // post-ECF (or plain) value by date
  const preECFMap = {}  // pre-ECF value, only set for ECF dates

  for (const dv of dailyValues) {
    valueMap[dv.date] = dv.valueUSD
    if (dv.preECFValueUSD != null) preECFMap[dv.date] = dv.preECFValueUSD
  }

  const sortedDates = dailyValues.map((d) => d.date).sort()
  const ecfDateSet = new Set(ecfEvents.map((e) => e.date))

  // Sub-period boundaries: first date + all ECF dates + last date
  const boundaries = [sortedDates[0], ...ecfEvents.map((e) => e.date), sortedDates.at(-1)]
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort()

  // Map from boundary-end-date → cumulative TWR at that boundary
  const twrAtBoundary = {}
  let cumulativeTWR = 1

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startDate = boundaries[i]
    const endDate = boundaries[i + 1]

    // Start: post-ECF value (capital being invested)
    const startValue = valueMap[startDate]
    // End: pre-ECF value if there's a flow on that date, else plain value
    const endValue = (ecfDateSet.has(endDate) && preECFMap[endDate] != null)
      ? preECFMap[endDate]
      : valueMap[endDate]

    if (!startValue || !endValue || startValue <= 0) continue

    cumulativeTWR *= (endValue / startValue)
    twrAtBoundary[endDate] = cumulativeTWR
  }

  // Build full daily TWR series — carry forward last known TWR value
  const result = []
  let lastTWR = 0
  for (const date of sortedDates) {
    if (twrAtBoundary[date] !== undefined) {
      lastTWR = (twrAtBoundary[date] - 1) * 100
    }
    result.push({ date, twr: lastTWR })
  }

  return result
}
