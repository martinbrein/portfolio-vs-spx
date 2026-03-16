import { useState, useMemo } from 'react'
import UploadSection from './components/UploadSection'
import OperationsTable from './components/OperationsTable'
import PortfolioTab from './components/PortfolioTab'
import CaucionesTab from './components/CaucionesTab'
import RendimientoTab from './components/RendimientoTab'
import CumulativeChart from './components/CumulativeChart'
import PortfolioValueChart from './components/PortfolioValueChart'
import DrawdownChart from './components/DrawdownChart'
import MetricsGrid from './components/MetricsGrid'
import PeriodSelector from './components/PeriodSelector'
import IndexSelector from './components/IndexSelector'

import { parseAllariaXLS } from './utils/parseAllaria'
import { buildPortfolioState, extractTickers } from './utils/holdingsTracker'
import { fetchAllPrices } from './utils/fetchArgPrices'
import { fetchMEPRates, fillMEPRates } from './utils/fetchMEP'
import { fetchIndexData } from './utils/fetchSPX'
import { buildDailyValues, calcTWR } from './utils/calcTWR'
import { calcMetrics, buildDrawdownData, filterByPeriod } from './utils/calculations'
import { INDICES } from './utils/indices'

const TABS = ['Operaciones', 'Cartera', 'Rendimiento', 'TWR vs Índice']

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/** Align TWR series with a benchmark index and normalise both to % return */
async function alignBenchmark(twr, indexKey, mepRatesMap) {
  const { symbol } = INDICES[indexKey]
  const rawData = await fetchIndexData(symbol, twr[0].date, twr.at(-1).date)

  // Merval: convert ARS prices → USD using MEP rate
  let finalData = rawData
  if (indexKey === 'MERVAL') {
    const mepSorted = Object.keys(mepRatesMap).sort()
    finalData = rawData.map((d) => {
      const prior = mepSorted.filter((md) => md <= d.date).at(-1)
      const mep = prior ? mepRatesMap[prior] : null
      return mep ? { date: d.date, value: d.value / mep } : null
    }).filter(Boolean)
  }

  const dataMap = new Map(finalData.map((d) => [d.date, d.value]))
  const dataDates = finalData.map((d) => d.date).sort()

  const aligned = twr.map((t) => {
    let val = dataMap.get(t.date)
    if (!val) {
      const before = dataDates.filter((d) => d <= t.date)
      if (before.length > 0) val = dataMap.get(before.at(-1))
    }
    return val != null ? { date: t.date, portfolio: t.twr, spx: val } : null
  }).filter(Boolean)

  if (aligned.length < 2) return null
  const base = aligned[0].spx
  return aligned.map((d) => ({ ...d, spx: (d.spx / base - 1) * 100 }))
}

export default function App() {
  const [ops, setOps] = useState(null)
  const [portfolioResult, setPortfolioResult] = useState(null)
  const [spxAligned, setSpxAligned] = useState(null)
  const [marketPrices, setMarketPrices] = useState({})
  const [priceSources, setPriceSources] = useState({})
  const [mepRates, setMepRates] = useState({})
  const [netContributions, setNetContributions] = useState(null)
  const [dailyValues, setDailyValues] = useState(null)
  const [twrData, setTwrData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [period, setPeriod] = useState('MAX')
  const [benchmarkIndex, setBenchmarkIndex] = useState('SPX')

  async function handleFile(file) {
    setLoading(true)
    setError(null)
    try {
      // Step 1: Parse XLS
      setLoadingStep('Leyendo extracto de Allaria...')
      const { ops: parsedOps, mepRatesFromOps } = await parseAllariaXLS(file)
      setOps(parsedOps)

      const state = buildPortfolioState(parsedOps, mepRatesFromOps)
      setPortfolioResult(state)

      const tickers = extractTickers(parsedOps)
      const dates = Object.keys(state.stateByDate).sort()
      const startDate = dates[0]
      const endDate = dates.at(-1)

      // Step 2: Fetch market prices
      let fetched = 0
      const { marketPrices: mp, priceSources: ps } = await fetchAllPrices(
        tickers, startDate, endDate,
        () => { fetched++; setLoadingStep(`Obteniendo precios... ${fetched}/${tickers.length}`) },
        state.bondTickers
      )
      setMarketPrices(mp)
      setPriceSources(ps)

      // Step 3: Fetch MEP rates (merge: fetched > XLS-extracted as fallback)
      setLoadingStep('Obteniendo tipo de cambio MEP...')
      const rawMEP = await fetchMEPRates(startDate, endDate)
      const mergedMEP = { ...mepRatesFromOps, ...rawMEP }
      const filledMEP = fillMEPRates(mergedMEP, dates)
      setMepRates(filledMEP)

      // Step 4: Build daily values + TWR
      setLoadingStep('Calculando TWR...')
      const { dailyValues, netContributionsUSD } = buildDailyValues(
        state.stateByDate, filledMEP, mp, state.knownPrices, state.ecfEvents
      )
      setDailyValues(dailyValues)
      setNetContributions(netContributionsUSD)
      const twr = calcTWR(dailyValues, state.ecfEvents)

      // Step 5: Fetch benchmark index and align
      if (twr.length >= 2) {
        setTwrData(twr)
        setLoadingStep(`Obteniendo datos de ${INDICES[benchmarkIndex].label}...`)
        const aligned = await alignBenchmark(twr, benchmarkIndex, filledMEP)
        if (aligned) setSpxAligned(aligned)
      }

      setFileName(file.name)
      setActiveTab(0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setLoadingStep('')
    }
  }

  async function handleBenchmarkChange(newIndex) {
    if (!twrData || twrData.length < 2) return
    setBenchmarkIndex(newIndex)
    setBenchmarkLoading(true)
    try {
      const aligned = await alignBenchmark(twrData, newIndex, mepRates)
      if (aligned) setSpxAligned(aligned)
    } catch (_) {
      // keep current benchmark on error
    } finally {
      setBenchmarkLoading(false)
    }
  }

  const filteredAligned = useMemo(
    () => (spxAligned ? filterByPeriod(spxAligned, period) : null),
    [spxAligned, period]
  )

  const alignedForMetrics = useMemo(
    () => filteredAligned?.map((d) => ({ date: d.date, portfolio: 100 + d.portfolio, spx: 100 + d.spx })),
    [filteredAligned]
  )

  const metrics = useMemo(() => alignedForMetrics ? calcMetrics(alignedForMetrics) : null, [alignedForMetrics])
  const drawdownData = useMemo(() => alignedForMetrics ? buildDrawdownData(alignedForMetrics) : null, [alignedForMetrics])

  const days = metrics?.days ?? 0
  const portReturn = filteredAligned?.at(-1)?.portfolio ?? 0
  const spxReturn = filteredAligned?.at(-1)?.spx ?? 0

  if (!ops) {
    return (
      <div className="min-h-screen bg-slate-900">
        <UploadSection onFile={handleFile} loading={loading} loadingStep={loadingStep} />
        {error && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-700 text-red-200 rounded-xl px-6 py-3 text-sm max-w-lg text-center shadow-lg">
            {error}
          </div>
        )}
      </div>
    )
  }

  const lastMEP = Object.keys(mepRates).sort().at(-1)
  const currentMEP = lastMEP ? mepRates[lastMEP] : null

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800/80 backdrop-blur border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-base font-bold text-white">
              Portfolio vs {INDICES[benchmarkIndex].label}
            </h1>
            <p className="text-slate-400 text-xs">
              {fileName} · {ops.filter((o) => o.type !== 'IGNORAR').length} operaciones
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {activeTab === 3 && (
              <>
                <IndexSelector selected={benchmarkIndex} onChange={handleBenchmarkChange} loading={benchmarkLoading} />
                <div className="w-px h-5 bg-slate-700" />
                <PeriodSelector selected={period} onChange={setPeriod} />
              </>
            )}
            <button
              onClick={() => { setOps(null); setPortfolioResult(null); setSpxAligned(null); setMarketPrices({}); setMepRates({}); setNetContributions(null); setDailyValues(null); setTwrData(null) }}
              className="text-slate-400 hover:text-white text-sm border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1 transition-colors"
            >
              Cambiar archivo
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 flex border-t border-slate-700/50">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
                ${activeTab === i ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 0 && (
          <div className="bg-slate-800 rounded-2xl p-6">
            <h2 className="text-white font-semibold mb-4">Operaciones clasificadas</h2>
            <OperationsTable ops={ops} />
          </div>
        )}

        {activeTab === 1 && portfolioResult && (
          <PortfolioTab
            holdings={portfolioResult.finalHoldings}
            marketPrices={marketPrices}
            priceSources={priceSources}
            knownPrices={portfolioResult.knownPrices}
            mepRate={currentMEP}
            arsBalance={portfolioResult.finalARS}
            usdBalance={portfolioResult.finalUSD}
          />
        )}

        {activeTab === 2 && portfolioResult && (
          <RendimientoTab
            ops={ops}
            marketPrices={marketPrices}
            knownPrices={portfolioResult.knownPrices}
            finalHoldings={portfolioResult.finalHoldings}
            mepRate={currentMEP}
            arsBalance={portfolioResult.finalARS}
            usdBalance={portfolioResult.finalUSD}
          />
        )}

        {activeTab === 3 && (
          <>
            {!filteredAligned || filteredAligned.length < 2 ? (
              <div className="bg-slate-800 rounded-2xl p-8 text-center">
                <p className="text-slate-400 mb-2">No hay suficientes datos para mostrar el TWR.</p>
                <p className="text-slate-500 text-sm">
                  Para calcular el TWR correctamente, subí el extracto completo desde la apertura de la cuenta.
                  Los bonos sin precio de mercado se valúan por interpolación desde precios de operaciones.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                  {[
                    { label: 'TWR Portfolio', value: `${portReturn >= 0 ? '+' : ''}${portReturn.toFixed(2)}%`, cls: portReturn >= 0 ? 'text-green-400' : 'text-red-400', sub: `CAGR ${metrics?.portfolio.cagr?.toFixed(1) ?? '—'}%` },
                    { label: INDICES[benchmarkIndex].label, value: `${spxReturn >= 0 ? '+' : ''}${spxReturn.toFixed(2)}%`, cls: spxReturn >= 0 ? 'text-green-400' : 'text-red-400', sub: `CAGR ${metrics?.spx.cagr?.toFixed(1) ?? '—'}%` },
                    { label: 'Exceso', value: `${(portReturn - spxReturn) >= 0 ? '+' : ''}${(portReturn - spxReturn).toFixed(2)}%`, cls: (portReturn - spxReturn) >= 0 ? 'text-green-400' : 'text-red-400', sub: `Alpha ${metrics?.comparison.alpha?.toFixed(1) ?? '—'}%` },
                    { label: 'Sharpe', value: metrics?.portfolio.sharpe?.toFixed(2) ?? '—', cls: (metrics?.portfolio.sharpe ?? 0) >= 1 ? 'text-green-400' : 'text-yellow-400', sub: `vs idx ${metrics?.spx.sharpe?.toFixed(2) ?? '—'}` },
                    { label: 'Aportes netos', value: netContributions != null ? `US$ ${fmt(netContributions, 0)}` : '—', cls: 'text-slate-300', sub: 'depósitos − retiros (MEP)' },
                  ].map(({ label, value, cls, sub }) => (
                    <div key={label} className="bg-slate-800 rounded-2xl p-5">
                      <p className="text-slate-400 text-xs mb-1">{label}</p>
                      <p className={`text-2xl font-bold font-mono ${cls}`}>{value}</p>
                      <p className="text-slate-500 text-xs mt-1">{sub}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-4 mb-6">
                  <PortfolioValueChart dailyValues={dailyValues} />
                  <CumulativeChart data={filteredAligned} days={days} benchmarkLabel={INDICES[benchmarkIndex].label} />
                  <DrawdownChart data={drawdownData} days={days} benchmarkLabel={INDICES[benchmarkIndex].label} />
                </div>
                <MetricsGrid metrics={metrics} benchmarkLabel={INDICES[benchmarkIndex].label} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
