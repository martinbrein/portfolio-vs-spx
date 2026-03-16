/**
 * CaucionesTab — displays all caución bursátil operations (APCOLCON / APCOLFUT).
 * APCOLCON = capital placement (negative importe = outflow)
 * APCOLFUT = return of capital + interest (positive importe = inflow)
 *
 * Pairs are matched chronologically within the same currency.
 */

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function pairCauciones(ops) {
  const caucionOps = ops
    .filter((op) => op.type === 'CAUCION')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  // Separate by currency
  const byCurrency = {}
  for (const op of caucionOps) {
    const cur = op.currency ?? 'ARS'
    if (!byCurrency[cur]) byCurrency[cur] = { placements: [], returns: [] }
    if ((op.importeNeto ?? 0) < 0) {
      byCurrency[cur].placements.push(op)
    } else {
      byCurrency[cur].returns.push(op)
    }
  }

  const pairs = []
  for (const [currency, { placements, returns }] of Object.entries(byCurrency)) {
    const usedReturns = new Set()
    for (const placement of placements) {
      // Find the nearest return after this placement date in the same currency
      const match = returns.find(
        (r, idx) => !usedReturns.has(idx) && r.date >= placement.date
      )
      const matchIdx = match ? returns.indexOf(match) : -1
      if (match) usedReturns.add(matchIdx)

      const capital = Math.abs(placement.importeNeto ?? 0)
      const returned = match ? Math.abs(match.importeNeto ?? 0) : null
      const interest = returned != null ? returned - capital : null
      const days = match
        ? Math.round((new Date(match.date) - new Date(placement.date)) / 86400000)
        : null
      const tna = (interest != null && capital > 0 && days > 0)
        ? (interest / capital) * (365 / days) * 100
        : null

      pairs.push({ placement, match, capital, returned, interest, days, tna, currency })
    }

    // Unmatched returns (returned without a known placement)
    for (let i = 0; i < returns.length; i++) {
      if (!usedReturns.has(i)) {
        pairs.push({ placement: null, match: returns[i], capital: null, returned: Math.abs(returns[i].importeNeto ?? 0), interest: null, days: null, tna: null, currency })
      }
    }
  }

  return pairs.sort((a, b) => {
    const da = (a.placement ?? a.match)?.date ?? ''
    const db = (b.placement ?? b.match)?.date ?? ''
    return da.localeCompare(db)
  })
}

export default function CaucionesTab({ ops }) {
  const pairs = pairCauciones(ops)

  const totals = pairs.reduce(
    (acc, p) => {
      const cur = p.currency
      if (!acc[cur]) acc[cur] = { capital: 0, interest: 0, count: 0 }
      if (p.capital) acc[cur].capital += p.capital
      if (p.interest) acc[cur].interest += p.interest
      if (p.placement) acc[cur].count++
      return acc
    },
    {}
  )

  if (pairs.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl p-8 text-center">
        <p className="text-slate-400">No hay cauciones en este extracto.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Summary cards */}
      <div className="flex flex-wrap gap-4 mb-6">
        {Object.entries(totals).map(([cur, t]) => (
          <div key={cur} className="bg-slate-800 rounded-2xl p-5 min-w-[200px]">
            <p className="text-slate-400 text-xs mb-1">
              {cur === 'ARS' ? 'Cauciones en Pesos' : cur === 'USD_MEP' ? 'Cauciones MEP (USD)' : 'Cauciones Cable (USD)'}
            </p>
            <p className="text-white text-xl font-bold font-mono">{t.count} colocaciones</p>
            <p className="text-cyan-400 text-sm font-mono mt-1">
              Interés total: {fmt(t.interest, 0)}
            </p>
            <p className="text-slate-500 text-xs mt-0.5">Capital total: {fmt(t.capital, 0)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-2xl p-6">
        <h2 className="text-white font-semibold mb-4">Detalle de cauciones</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-700/50 text-left">
                <th className="px-3 py-2 text-slate-400 text-xs font-medium">F. Colocación</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium">F. Vencimiento</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-center">Días</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">Capital</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">Retorno</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">Interés</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">TNA</th>
                <th className="px-3 py-2 text-slate-400 text-xs font-medium text-center">Mon.</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p, i) => {
                const cur = p.currency
                const moneda = cur === 'ARS' ? '$' : cur === 'USD_MEP' ? 'USD' : 'U$S'
                const isOpen = !p.match
                return (
                  <tr key={i} className="border-t border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs whitespace-nowrap">
                      {p.placement?.date ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs whitespace-nowrap">
                      {isOpen
                        ? <span className="text-yellow-400">abierta</span>
                        : p.match?.date ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-slate-300 text-xs font-mono">
                      {p.days ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-red-400 text-xs whitespace-nowrap">
                      {p.capital != null ? fmt(p.capital) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-400 text-xs whitespace-nowrap">
                      {p.returned != null ? fmt(p.returned) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-cyan-400 text-xs whitespace-nowrap font-medium">
                      {p.interest != null ? `+${fmt(p.interest)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300 text-xs whitespace-nowrap">
                      {p.tna != null ? `${p.tna.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{moneda}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
