function fmt(n, dec = 2, prefix = '') {
  if (n == null || isNaN(n)) return '—'
  return prefix + n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const SOURCE_BADGE = {
  iol:          { label: 'IOL',         cls: 'bg-violet-900 text-violet-300' },
  yahoo:        { label: 'Yahoo',       cls: 'bg-blue-900 text-blue-300' },
  cafci:        { label: 'CAFCI',       cls: 'bg-green-900 text-green-300' },
  interpolated: { label: 'Interpolado', cls: 'bg-yellow-900 text-yellow-300' },
  none:         { label: 'Sin precio',  cls: 'bg-red-900 text-red-300' },
}

export default function PortfolioTab({ holdings, marketPrices, priceSources, knownPrices, mepRate, arsBalance, usdBalance }) {
  const totalUSD = usdBalance ?? 0
  let totalARS = arsBalance ?? 0

  const rows = holdings.map(({ ticker, qty }) => {
    // Get most recent market price
    const prices = marketPrices?.[ticker] ?? {}
    const lastDate = Object.keys(prices).sort().at(-1)
    const priceARS = lastDate ? prices[lastDate] : null

    // Fallback: last known price from operations
    const knownList = knownPrices?.[ticker] ?? []
    const lastKnown = knownList.sort((a, b) => a.date.localeCompare(b.date)).at(-1)

    const finalPrice = priceARS ?? lastKnown?.price ?? null
    const source = priceARS ? (priceSources?.[ticker] ?? 'yahoo') : lastKnown ? 'interpolated' : 'none'
    const valueARS = finalPrice != null ? qty * finalPrice : null

    if (valueARS != null) totalARS += valueARS

    return { ticker, qty, priceARS: finalPrice, valueARS, source }
  })

  const totalUSDEquiv = mepRate ? totalARS / mepRate + totalUSD : null

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs mb-1">Total USD (est.)</p>
          <p className="text-white text-xl font-bold font-mono">
            {totalUSDEquiv != null ? `US$ ${fmt(totalUSDEquiv)}` : '—'}
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs mb-1">Efectivo ARS</p>
          <p className="text-white text-xl font-bold font-mono">$ {fmt(arsBalance)}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs mb-1">Efectivo USD (MEP)</p>
          <p className="text-white text-xl font-bold font-mono">US$ {fmt(usdBalance)}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs mb-1">Tipo MEP</p>
          <p className="text-white text-xl font-bold font-mono">
            {mepRate ? `$ ${fmt(mepRate)}` : 'Sin datos'}
          </p>
        </div>
      </div>

      {/* Holdings table */}
      <div className="bg-slate-800 rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4">Holdings actuales</h3>
        {rows.length === 0 ? (
          <p className="text-slate-500 text-sm">No hay posiciones abiertas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="pb-2 text-left text-xs text-slate-400 font-medium">Ticker</th>
                  <th className="pb-2 text-right text-xs text-slate-400 font-medium">Cantidad</th>
                  <th className="pb-2 text-right text-xs text-slate-400 font-medium">Precio ARS</th>
                  <th className="pb-2 text-right text-xs text-slate-400 font-medium">Valor ARS</th>
                  <th className="pb-2 text-right text-xs text-slate-400 font-medium">Valor USD</th>
                  <th className="pb-2 text-center text-xs text-slate-400 font-medium">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ticker, qty, priceARS, valueARS, source }) => {
                  const badge = SOURCE_BADGE[source] ?? SOURCE_BADGE.none
                  const valueUSD = valueARS != null && mepRate ? valueARS / mepRate : null
                  return (
                    <tr key={ticker} className="border-t border-slate-700/50">
                      <td className="py-2.5 font-mono text-blue-300 font-medium">{ticker}</td>
                      <td className="py-2.5 text-right font-mono text-slate-300">{fmt(qty, 2)}</td>
                      <td className="py-2.5 text-right font-mono text-slate-300">
                        {priceARS != null ? `$ ${fmt(priceARS, 4)}` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-300">
                        {valueARS != null ? `$ ${fmt(valueARS, 0)}` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-slate-300">
                        {valueUSD != null ? `US$ ${fmt(valueUSD, 0)}` : '—'}
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {/* Cash rows */}
                <tr className="border-t border-slate-700/50 bg-slate-700/20">
                  <td className="py-2.5 text-slate-400 font-medium">Efectivo ARS</td>
                  <td className="py-2.5 text-right font-mono text-slate-300">—</td>
                  <td className="py-2.5 text-right font-mono text-slate-300">—</td>
                  <td className="py-2.5 text-right font-mono text-slate-300">$ {fmt(arsBalance, 0)}</td>
                  <td className="py-2.5 text-right font-mono text-slate-300">
                    {mepRate ? `US$ ${fmt(arsBalance / mepRate, 0)}` : '—'}
                  </td>
                  <td />
                </tr>
                {(usdBalance ?? 0) !== 0 && (
                  <tr className="border-t border-slate-700/50 bg-slate-700/20">
                    <td className="py-2.5 text-slate-400 font-medium">Efectivo USD (MEP)</td>
                    <td colSpan={3} />
                    <td className="py-2.5 text-right font-mono text-slate-300">US$ {fmt(usdBalance, 0)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
