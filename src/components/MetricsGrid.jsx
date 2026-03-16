function fmt(val, decimals = 2, suffix = '%') {
  if (val == null || isNaN(val)) return '—'
  const sign = val > 0 ? '+' : ''
  return `${sign}${val.toFixed(decimals)}${suffix}`
}

function fmtPlain(val, decimals = 2, suffix = '') {
  if (val == null || isNaN(val)) return '—'
  return `${val.toFixed(decimals)}${suffix}`
}

function color(val, positiveIsGood = true) {
  if (val == null || isNaN(val)) return 'text-slate-400'
  if (val === 0) return 'text-slate-400'
  const good = positiveIsGood ? val > 0 : val < 0
  return good ? 'text-green-400' : 'text-red-400'
}

function Row({ label, portfolio, spx, portClass, spxClass }) {
  return (
    <tr className="border-b border-slate-700/50">
      <td className="py-3 pr-4 text-slate-400 text-sm">{label}</td>
      <td className={`py-3 pr-4 text-right font-mono text-sm font-medium ${portClass}`}>{portfolio}</td>
      <td className={`py-3 text-right font-mono text-sm font-medium ${spxClass}`}>{spx}</td>
    </tr>
  )
}

export default function MetricsGrid({ metrics }) {
  if (!metrics) return null
  const { portfolio: p, spx: s, comparison: c } = metrics

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Returns */}
      <div className="lg:col-span-2 bg-slate-800 rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4">Métricas comparativas</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="pb-2 text-left text-xs text-slate-500 uppercase tracking-wider">Métrica</th>
              <th className="pb-2 text-right text-xs text-blue-400 uppercase tracking-wider">Portfolio</th>
              <th className="pb-2 text-right text-xs text-orange-400 uppercase tracking-wider">S&P 500</th>
            </tr>
          </thead>
          <tbody>
            <Row
              label="Retorno total"
              portfolio={fmt(p.totalReturn)}
              spx={fmt(s.totalReturn)}
              portClass={color(p.totalReturn)}
              spxClass={color(s.totalReturn)}
            />
            <Row
              label="CAGR (anualizado)"
              portfolio={fmt(p.cagr)}
              spx={fmt(s.cagr)}
              portClass={color(p.cagr)}
              spxClass={color(s.cagr)}
            />
            <Row
              label="Volatilidad anualizada"
              portfolio={fmt(p.vol)}
              spx={fmt(s.vol)}
              portClass="text-slate-200"
              spxClass="text-slate-200"
            />
            <Row
              label="Sharpe ratio"
              portfolio={fmtPlain(p.sharpe)}
              spx={fmtPlain(s.sharpe)}
              portClass={color(p.sharpe)}
              spxClass={color(s.sharpe)}
            />
            <Row
              label="Mejor día"
              portfolio={fmt(p.bestDay)}
              spx={fmt(s.bestDay)}
              portClass="text-green-400"
              spxClass="text-green-400"
            />
            <Row
              label="Peor día"
              portfolio={fmt(p.worstDay)}
              spx={fmt(s.worstDay)}
              portClass="text-red-400"
              spxClass="text-red-400"
            />
          </tbody>
        </table>
      </div>

      {/* Comparison stats */}
      <div className="bg-slate-800 rounded-2xl p-6 flex flex-col gap-4">
        <h3 className="text-white font-semibold">Relación con el S&P 500</h3>
        {[
          { label: 'Alpha (anualizado)', value: fmt(c.alpha), cls: color(c.alpha) },
          { label: 'Beta', value: fmtPlain(c.beta), cls: 'text-slate-200' },
          { label: 'Correlación', value: fmtPlain(c.correlation), cls: 'text-slate-200' },
          { label: 'Tracking Error', value: fmt(c.trackingError), cls: 'text-slate-200' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="bg-slate-700/50 rounded-xl p-4">
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${cls}`}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
