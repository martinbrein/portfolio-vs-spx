// Align portfolio data with SPX data by date (forward-fill SPX for missing dates)
export function alignData(portfolioData, spxData) {
  const spxMap = new Map(spxData.map((d) => [d.date, d.value]))
  const spxDates = spxData.map((d) => d.date).sort()

  const aligned = []
  for (const pd of portfolioData) {
    let spxValue = spxMap.get(pd.date)
    if (spxValue == null) {
      // Forward-fill: find most recent SPX date <= portfolio date
      const idx = spxDates.findLastIndex((d) => d <= pd.date)
      if (idx >= 0) spxValue = spxMap.get(spxDates[idx])
    }
    if (spxValue != null) {
      aligned.push({ date: pd.date, portfolio: pd.value, spx: spxValue })
    }
  }
  return aligned
}

function dailyReturns(values) {
  const r = []
  for (let i = 1; i < values.length; i++) {
    r.push((values[i] - values[i - 1]) / values[i - 1])
  }
  return r
}

function annualizedReturn(start, end, days) {
  const years = days / 365.25
  return (Math.pow(end / start, 1 / years) - 1) * 100
}

function annualizedVol(returns) {
  if (returns.length < 2) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance * 252) * 100
}

function maxDrawdown(values) {
  let peak = values[0]
  let maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = (v - peak) / peak
    if (dd < maxDD) maxDD = dd
  }
  return maxDD * 100
}

function betaAndCorr(portReturns, spxReturns) {
  const n = Math.min(portReturns.length, spxReturns.length)
  if (n < 2) return { beta: 1, corr: 0 }
  const pR = portReturns.slice(0, n)
  const bR = spxReturns.slice(0, n)
  const meanP = pR.reduce((a, b) => a + b, 0) / n
  const meanB = bR.reduce((a, b) => a + b, 0) / n
  let cov = 0, varB = 0, varP = 0
  for (let i = 0; i < n; i++) {
    cov += (pR[i] - meanP) * (bR[i] - meanB)
    varB += (bR[i] - meanB) ** 2
    varP += (pR[i] - meanP) ** 2
  }
  cov /= n - 1
  varB /= n - 1
  varP /= n - 1
  const beta = varB === 0 ? 0 : cov / varB
  const corr = varP === 0 || varB === 0 ? 0 : cov / Math.sqrt(varP * varB)
  return { beta, corr }
}

export function calcMetrics(data, riskFreeRate = 5) {
  if (data.length < 2) return null
  const portValues = data.map((d) => d.portfolio)
  const spxValues = data.map((d) => d.spx)
  const portReturns = dailyReturns(portValues)
  const spxReturns = dailyReturns(spxValues)

  const days = (new Date(data.at(-1).date) - new Date(data[0].date)) / 86400000
  const portCAGR = annualizedReturn(portValues[0], portValues.at(-1), days)
  const spxCAGR = annualizedReturn(spxValues[0], spxValues.at(-1), days)
  const portVol = annualizedVol(portReturns)
  const spxVol = annualizedVol(spxReturns)
  const portMaxDD = maxDrawdown(portValues)
  const spxMaxDD = maxDrawdown(spxValues)
  const portTotalReturn = (portValues.at(-1) / portValues[0] - 1) * 100
  const spxTotalReturn = (spxValues.at(-1) / spxValues[0] - 1) * 100
  const { beta, corr } = betaAndCorr(portReturns, spxReturns)

  // Tracking error
  const diffReturns = portReturns.map((r, i) => r - (spxReturns[i] ?? 0))
  const trackingError = annualizedVol(diffReturns)

  return {
    portfolio: {
      totalReturn: portTotalReturn,
      cagr: portCAGR,
      vol: portVol,
      sharpe: portVol === 0 ? 0 : (portCAGR - riskFreeRate) / portVol,
      maxDrawdown: portMaxDD,
      calmar: portMaxDD === 0 ? 0 : portCAGR / Math.abs(portMaxDD),
      bestDay: Math.max(...portReturns) * 100,
      worstDay: Math.min(...portReturns) * 100,
    },
    spx: {
      totalReturn: spxTotalReturn,
      cagr: spxCAGR,
      vol: spxVol,
      sharpe: spxVol === 0 ? 0 : (spxCAGR - riskFreeRate) / spxVol,
      maxDrawdown: spxMaxDD,
      calmar: spxMaxDD === 0 ? 0 : spxCAGR / Math.abs(spxMaxDD),
      bestDay: Math.max(...spxReturns) * 100,
      worstDay: Math.min(...spxReturns) * 100,
    },
    comparison: {
      beta,
      alpha: portCAGR - spxCAGR,   // excess CAGR over benchmark
      correlation: corr,
      trackingError,
    },
    days,
  }
}

export function buildCumulativeData(data) {
  const portBase = data[0].portfolio
  const spxBase = data[0].spx
  return data.map((d) => ({
    date: d.date,
    portfolio: ((d.portfolio / portBase) - 1) * 100,
    spx: ((d.spx / spxBase) - 1) * 100,
  }))
}

export function buildDrawdownData(data) {
  let portPeak = data[0].portfolio
  let spxPeak = data[0].spx
  return data.map((d) => {
    if (d.portfolio > portPeak) portPeak = d.portfolio
    if (d.spx > spxPeak) spxPeak = d.spx
    return {
      date: d.date,
      portfolio: ((d.portfolio - portPeak) / portPeak) * 100,
      spx: ((d.spx - spxPeak) / spxPeak) * 100,
    }
  })
}

export function filterByPeriod(data, period) {
  if (period === 'MAX' || data.length === 0) return data
  const lastDate = new Date(data.at(-1).date)
  let start
  switch (period) {
    case 'YTD': start = new Date(lastDate.getFullYear(), 0, 1); break
    case '1M': start = new Date(lastDate); start.setMonth(start.getMonth() - 1); break
    case '3M': start = new Date(lastDate); start.setMonth(start.getMonth() - 3); break
    case '6M': start = new Date(lastDate); start.setMonth(start.getMonth() - 6); break
    case '1A': start = new Date(lastDate); start.setFullYear(start.getFullYear() - 1); break
    case '3A': start = new Date(lastDate); start.setFullYear(start.getFullYear() - 3); break
    default: return data
  }
  const startStr = start.toISOString().split('T')[0]
  const filtered = data.filter((d) => d.date >= startStr)
  return filtered.length >= 2 ? filtered : data
}
