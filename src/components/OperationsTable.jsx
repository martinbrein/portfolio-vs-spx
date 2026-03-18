import { useState } from 'react'
import { OPERATION_LABELS, OPERATION_COLORS } from '../utils/classifyOperation'

const TYPE_FILTERS = ['Todos', 'COMPRA', 'VENTA', 'CAUCION', 'SUSCRIPCION', 'RESCATE', 'DIVIDENDO', 'CUPON', 'AMORTIZACION', 'DEPOSITO', 'RETIRO']

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/**
 * Look up the closest MEP rate on or before a given date.
 * Returns null if no data available before that date.
 */
function lookupMEP(date, mepRates) {
  if (!mepRates || !date) return null
  const sorted = Object.keys(mepRates).sort()
  const prior = sorted.filter((d) => d <= date).at(-1)
  return prior ? mepRates[prior] : null
}

/**
 * Return the USD value of an operation's importeNeto.
 * - USD_MEP / USD_CABLE ops: already in USD → use as-is.
 * - ARS ops: divide by the MEP rate for that day.
 */
function toUSD(op, mepRates) {
  if (op.importeNeto == null) return null
  const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'
  if (isUSD) return op.importeNeto
  const rate = lookupMEP(op.date, mepRates)
  if (!rate) return null
  return op.importeNeto / rate
}

export default function OperationsTable({ ops, mepRates }) {
  const [filter, setFilter] = useState('Todos')
  const [search, setSearch] = useState('')

  const visible = ops
    .filter((op) => op.type !== 'IGNORAR')
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .filter((op) => filter === 'Todos' || op.type === filter)
    .filter((op) => {
      if (!search) return true
      const s = search.toLowerCase()
      return (
        op.ticker?.toLowerCase().includes(s) ||
        op.detalle?.toLowerCase().includes(s) ||
        op.type?.toLowerCase().includes(s)
      )
    })

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Buscar ticker o descripción..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-700 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none focus:border-blue-400 w-56"
        />
        <div className="flex flex-wrap gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors
                ${filter === t ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-white bg-slate-700'}`}
            >
              {t === 'Todos' ? 'Todos' : OPERATION_LABELS[t] ?? t}
            </button>
          ))}
        </div>
        <span className="text-slate-500 text-xs ml-auto">{visible.length} operaciones</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-700/50 text-left">
              <th className="px-3 py-2 text-slate-400 text-xs font-medium">Fecha</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium">Tipo</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium">Ticker</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium">Descripción</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">V. Nominal</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">Precio</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right">Importe</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-center">Mon.</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right" title="Dólar MEP del día (AL30/AL30D)">MEP</th>
              <th className="px-3 py-2 text-slate-400 text-xs font-medium text-right" title="Importe convertido a dólares usando el MEP del día">Importe USD</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  No hay operaciones con ese filtro.
                </td>
              </tr>
            ) : (
              visible.map((op, i) => {
                const mep = lookupMEP(op.date, mepRates)
                const usdValue = toUSD(op, mepRates)
                const isUSDOp = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'
                const usdPos = (usdValue ?? 0) >= 0
                return (
                  <tr
                    key={i}
                    className="border-t border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="px-3 py-2 text-slate-400 font-mono text-xs whitespace-nowrap">{op.date}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`font-medium text-xs ${OPERATION_COLORS[op.type] ?? 'text-slate-400'}`}>
                        {OPERATION_LABELS[op.type] ?? op.type}
                      </span>
                      {op.isECF && (
                        <span className="ml-1 text-xs text-purple-400 font-mono">[ECF]</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-blue-300 text-xs">{op.ticker ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs max-w-xs truncate" title={op.detalle}>
                      {op.detalle}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300 text-xs whitespace-nowrap">
                      {fmt(op.valorNominal)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300 text-xs whitespace-nowrap">
                      {fmt(op.precio, 4)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-xs whitespace-nowrap font-medium
                      ${(op.importeNeto ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(op.importeNeto ?? 0) >= 0 ? '+' : ''}{fmt(op.importeNeto)}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">
                      {isUSDOp ? 'USD' : '$'}
                    </td>
                    {/* MEP del día */}
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-400 whitespace-nowrap">
                      {mep != null ? `$ ${fmt(mep, 0)}` : '—'}
                    </td>
                    {/* Importe en USD */}
                    <td className={`px-3 py-2 text-right font-mono text-xs whitespace-nowrap font-medium
                      ${usdPos ? 'text-green-400' : 'text-red-400'}`}>
                      {usdValue != null
                        ? `${usdPos ? '+' : ''}US$ ${fmt(Math.abs(usdValue), 0)}`
                        : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
