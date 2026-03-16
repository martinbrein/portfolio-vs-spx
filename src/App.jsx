import { useState, useMemo } from 'react'
import UploadSection from './components/UploadSection'
import CumulativeChart from './components/CumulativeChart'
import DrawdownChart from './components/DrawdownChart'
import MetricsGrid from './components/MetricsGrid'
import PeriodSelector from './components/PeriodSelector'
import { parsePortfolioExcel } from './utils/parseExcel'
import { fetchSPXData } from './utils/fetchSPX'
import {
  alignData,
  calcMetrics,
  buildCumulativeData,
  buildDrawdownData,
  filterByPeriod,
} from './utils/calculations'

export default function App() {
  const [rawAligned, setRawAligned] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('MAX')
  const [fileName, setFileName] = useState(null)

  async function handleFile(file) {
    setLoading(true)
    setError(null)
    try {
      const portfolio = await parsePortfolioExcel(file)
      const startDate = portfolio[0].date
      const endDate = portfolio.at(-1).date
      const spx = await fetchSPXData(startDate, endDate)
      const aligned = alignData(portfolio, spx)
      if (aligned.length < 5) throw new Error('No hay suficientes fechas en común entre el portfolio y el S&P 500.')
      setRawAligned(aligned)
      setFileName(file.name)
      setPeriod('MAX')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredData = useMemo(
    () => (rawAligned ? filterByPeriod(rawAligned, period) : null),
    [rawAligned, period]
  )

  const metrics = useMemo(() => (filteredData ? calcMetrics(filteredData) : null), [filteredData])
  const cumulativeData = useMemo(() => (filteredData ? buildCumulativeData(filteredData) : null), [filteredData])
  const drawdownData = useMemo(() => (filteredData ? buildDrawdownData(filteredData) : null), [filteredData])

  if (!rawAligned) {
    return (
      <div className="min-h-screen bg-slate-900">
        <UploadSection onFile={handleFile} loading={loading} />
        {error && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-700 text-red-200 rounded-xl px-6 py-3 text-sm max-w-md text-center">
            {error}
          </div>
        )}
      </div>
    )
  }

  const days = metrics?.days ?? 0
  const portReturn = metrics?.portfolio.totalReturn ?? 0
  const spxReturn = metrics?.spx.totalReturn ?? 0
  const excess = portReturn - spxReturn

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Portfolio vs S&P 500</h1>
            <p className="text-slate-400 text-xs">{fileName}</p>
          </div>
          <div className="flex items-center gap-4">
            <PeriodSelector selected={period} onChange={setPeriod} />
            <button
              onClick={() => { setRawAligned(null); setError(null) }}
              className="text-slate-400 hover:text-white text-sm border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1 transition-colors"
            >
              Cambiar archivo
            </button>
          </div>
        </div>
      </header>

      {/* Summary cards */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Portfolio',
              value: `${portReturn >= 0 ? '+' : ''}${portReturn.toFixed(2)}%`,
              cls: portReturn >= 0 ? 'text-green-400' : 'text-red-400',
              sub: `CAGR ${metrics?.portfolio.cagr?.toFixed(1)}%`,
            },
            {
              label: 'S&P 500',
              value: `${spxReturn >= 0 ? '+' : ''}${spxReturn.toFixed(2)}%`,
              cls: spxReturn >= 0 ? 'text-green-400' : 'text-red-400',
              sub: `CAGR ${metrics?.spx.cagr?.toFixed(1)}%`,
            },
            {
              label: 'Exceso de retorno',
              value: `${excess >= 0 ? '+' : ''}${excess.toFixed(2)}%`,
              cls: excess >= 0 ? 'text-green-400' : 'text-red-400',
              sub: `Alpha ${metrics?.comparison.alpha?.toFixed(1)}%`,
            },
            {
              label: 'Sharpe portfolio',
              value: metrics?.portfolio.sharpe?.toFixed(2) ?? '—',
              cls: (metrics?.portfolio.sharpe ?? 0) >= 1 ? 'text-green-400' : 'text-yellow-400',
              sub: `vs SPX ${metrics?.spx.sharpe?.toFixed(2)}`,
            },
          ].map(({ label, value, cls, sub }) => (
            <div key={label} className="bg-slate-800 rounded-2xl p-5">
              <p className="text-slate-400 text-xs mb-1">{label}</p>
              <p className={`text-2xl font-bold font-mono ${cls}`}>{value}</p>
              <p className="text-slate-500 text-xs mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="flex flex-col gap-4 mb-6">
          <CumulativeChart data={cumulativeData} days={days} />
          <DrawdownChart data={drawdownData} days={days} />
        </div>

        {/* Metrics table */}
        <div className="mb-8">
          <MetricsGrid metrics={metrics} />
        </div>
      </div>
    </div>
  )
}
