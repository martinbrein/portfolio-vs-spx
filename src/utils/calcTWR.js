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
 * @returns {number|null} portfolio value in USD, or null if cannot be computed
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
 * Algorithm:
 * 1. Sort ECF events by date
 * 2. For each sub-period between ECFs, calculate return:
 *    R_i = V_end / V_start - 1
 *    where V_end = portfolio value BEFORE the next ECF
 *    and   V_start = portfolio value AFTER previous ECF
 * 3. TWR = (1+R1)(1+R2)...(1+Rn) - 1
 *
 * @param {Array} dailyValues - [{date, valueUSD, hasAllPrices}] sorted by date
 * @param {Array} ecfEvents - [{date, direction, amountUSD_equiv}]
 * @returns {Array} [{date, twr, subPeriodReturn}]
 */
export function calcTWR(dailyValues, ecfEvents) {
  if (!dailyValues || dailyValues.length < 2) return []

  const valueMap = {}
  for (const dv of dailyValues) {
    valueMap[dv.date] = dv.valueUSD
  }

  const sortedDates = dailyValues.map((d) => d.date).sort()
  const ecfDates = new Set(ecfEvents.map((e) => e.date))

  // Build sub-period boundaries
  const boundaries = [sortedDates[0], ...ecfEvents.map((e) => e.date), sortedDates.at(-1)]
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort()

  const twrSeries = []
  let cumulativeTWR = 1

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startDate = boundaries[i]
    const endDate = boundaries[i + 1]

    const startValue = valueMap[startDate]
    const endValue = valueMap[endDate]

    if (!startValue || !endValue || startValue <= 0) continue

    const subPeriodReturn = endValue / startValue - 1
    cumulativeTWR *= 1 + subPeriodReturn

    twrSeries.push({
      date: endDate,
      twr: (cumulativeTWR - 1) * 100,
      subPeriodReturn: subPeriodReturn * 100,
    })
  }

  // Build full daily TWR series by interpolating between sub-period boundaries
  const twrByDate = {}
  for (const t of twrSeries) twrByDate[t.date] = t.twr

  // Fill in all dates
  const result = []
  let lastTWR = 0
  for (const date of sortedDates) {
    if (twrByDate[date] !== undefined) lastTWR = twrByDate[date]
    result.push({ date, twr: lastTWR })
  }

  return result
}

/**
 * Build daily portfolio values array from state snapshots + prices
 */
export function buildDailyValues(stateByDate, mepRates, marketPrices, knownPrices) {
  const dates = Object.keys(stateByDate).sort()
  const result = []

  for (const date of dates) {
    const state = stateByDate[date]
    const mepRate = mepRates[date] ?? findNearestMEP(mepRates, date)
    if (!mepRate) continue

    const { value, hasAllPrices } = calcPortfolioValue(state, date, mepRate, marketPrices, knownPrices) ?? {}
    if (value != null) {
      result.push({ date, valueUSD: value, hasAllPrices })
    }
  }

  return result
}

function findNearestMEP(mepRates, date) {
  const dates = Object.keys(mepRates).sort()
  const before = dates.filter((d) => d <= date)
  return before.length > 0 ? mepRates[before.at(-1)] : null
}
