import { interpolatePrice } from './holdingsTracker'

/**
 * Calculate portfolio value in USD on a given date.
 * - ARS cash → converted via MEP rate
 * - USD cash → direct
 * - Holdings → valued using marketPrices[ticker][date] or interpolated from knownPrices
 *
 * @param {object} state - { arsBalance, usdBalance, holdings }
 * @param {string} date
 * @param {number} mepRate - ARS per USD on that date
 * @param {object} marketPrices - { ticker: { date: priceARS } }
 * @param {object} knownPrices - { ticker: [{date, price}] } from operations
 * @returns {{ value: number, hasAllPrices: boolean }|null}
 */
export function calcPortfolioValue(state, date, mepRate, marketPrices, knownPrices) {
  if (!mepRate || mepRate <= 0) return null

  let totalARS = state.arsBalance ?? 0
  let totalUSD = state.usdBalance ?? 0
  let hasAllPrices = true

  for (const [ticker, qty] of Object.entries(state.holdings ?? {})) {
    if (qty <= 0) continue

    // Try market price first, then interpolate from known op prices
    let priceARS = marketPrices?.[ticker]?.[date]

    if (priceARS == null) {
      priceARS = interpolatePrice(ticker, date, knownPrices)
    }

    if (priceARS == null) {
      hasAllPrices = false
      continue // Skip this holding
    }

    totalARS += qty * priceARS
  }

  const totalUSDValue = totalUSD + totalARS / mepRate
  return { value: totalUSDValue, hasAllPrices }
}

/**
 * Calculate Time Weighted Return.
 *
 * Each sub-period: [ECF_date_i, ECF_date_{i+1}]
 *   R_i = V_pre_ECF(end) / V_post_ECF(start) - 1
 *
 * V_pre_ECF is stored in dailyValues[date].preECFValueUSD (computed in buildDailyValues).
 * This eliminates the distortion caused by cash inflows/outflows.
 *
 * @param {Array} dailyValues - [{date, valueUSD, preECFValueUSD?}] sorted by date
 * @param {Array} ecfEvents - [{date, direction, amountARS, amountUSD}]
 * @returns {Array} [{date, twr}]
 */
export function calcTWR(dailyValues, ecfEvents) {
  if (!dailyValues || dailyValues.length < 2) return []

  const valueMap = {}    // post-ECF (or plain) value
  const preECFMap = {}   // pre-ECF value, only set for ECF dates

  for (const dv of dailyValues) {
    valueMap[dv.date] = dv.valueUSD
    if (dv.preECFValueUSD != null) preECFMap[dv.date] = dv.preECFValueUSD
  }

  const sortedDates = dailyValues.map((d) => d.date).sort()

  // Build sub-period boundaries from ECF dates
  const boundaries = [sortedDates[0], ...ecfEvents.map((e) => e.date), sortedDates.at(-1)]
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort()

  const twrSeries = []
  let cumulativeTWR = 1

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startDate = boundaries[i]
    const endDate = boundaries[i + 1]

    // startValue: value AFTER any ECF on startDate (post-ECF = capital being invested)
    const startValue = valueMap[startDate]

    // endValue: value BEFORE any ECF on endDate (pre-ECF = pure performance, no flow distortion)
    // For the last boundary we use the plain value (no next ECF to exclude)
    const endValue = preECFMap[endDate] != null ? preECFMap[endDate] : valueMap[endDate]

    if (!startValue || !endValue || startValue <= 0) continue

    const subPeriodReturn = endValue / startValue - 1
    cumulativeTWR *= 1 + subPeriodReturn

    twrSeries.push({
      date: endDate,
      twr: (cumulativeTWR - 1) * 100,
      subPeriodReturn: subPeriodReturn * 100,
    })
  }

  // Build full daily TWR series — carry forward last known value
  const twrByDate = {}
  for (const t of twrSeries) twrByDate[t.date] = t.twr

  const result = []
  let lastTWR = 0
  for (const date of sortedDates) {
    if (twrByDate[date] !== undefined) lastTWR = twrByDate[date]
    result.push({ date, twr: lastTWR })
  }

  return result
}

/**
 * Build daily portfolio values array from state snapshots + prices.
 * For ECF dates, also computes the pre-ECF value (portfolio value before the cash flow),
 * which is required for correct TWR sub-period calculations.
 *
 * @returns {{ dailyValues: Array, netContributionsUSD: number }}
 *   netContributionsUSD: total deposits minus withdrawals, each converted to USD at that day's MEP
 */
export function buildDailyValues(stateByDate, mepRates, marketPrices, knownPrices, ecfEvents = []) {
  const dates = Object.keys(stateByDate).sort()

  // Group ECF events by date
  const ecfByDate = {}
  for (const ecf of ecfEvents) {
    if (!ecfByDate[ecf.date]) ecfByDate[ecf.date] = []
    ecfByDate[ecf.date].push(ecf)
  }

  const result = []
  let netContributionsUSD = 0

  for (const date of dates) {
    const state = stateByDate[date]
    const mepRate = mepRates[date] ?? findNearestMEP(mepRates, date)
    if (!mepRate) continue

    const { value, hasAllPrices } = calcPortfolioValue(state, date, mepRate, marketPrices, knownPrices) ?? {}
    if (value == null) continue

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
      // Pre-ECF value = post-ECF value minus the net cash flow added that day
      preECFValueUSD = value - netFlowUSD
    }

    result.push({ date, valueUSD: value, preECFValueUSD, hasAllPrices })
  }

  return { dailyValues: result, netContributionsUSD }
}

function findNearestMEP(mepRates, date) {
  const dates = Object.keys(mepRates).sort()
  const before = dates.filter((d) => d <= date)
  return before.length > 0 ? mepRates[before.at(-1)] : null
}
