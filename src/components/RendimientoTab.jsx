/**
 * RendimientoTab — per-asset performance analysis.
 * Shows for each ticker:
 *  - Average buy price (ARS)
 *  - Current or sell price (ARS)
 *  - Price change %
 *  - Unrealized / realized P&L in USD
 *  - Contribution to total portfolio value (%)
 */

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/** Convert operation price to ARS per unit, same logic as holdingsTracker */
function toARSPrice(op) {
  const price = op.precio
  if (!price || price <= 0) {
    const qty = Math.abs(op.valorNominal ?? 0)
    return qty > 0 ? Math.abs(op.importeNeto ?? 0) / qty : 0
  }
  const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'
  if (isUSD && (op.tipoCambio ?? 1) > 1) {
    return price < 5
      ? price * op.tipoCambio          // FCI (cuotaparte USD)
      : (price / 100) * op.tipoCambio  // Bond % of par
  }
  return price // ARS section: direct price
}

/** Get most recent ARS price for a ticker from market prices */
function getLatestMarketPrice(ticker, marketPrices, knownPrices) {
  const mkt = marketPrices?.[ticker] ?? {}
  const lastMktDate = Object.keys(mkt).sort().at(-1)
  if (lastMktDate) return { price: mkt[lastMktDate], source: 'market' }
  const known = (knownPrices?.[ticker] ?? []).sort((a, b) => a.date.localeCompare(b.date))
  if (known.length > 0) return { price: known.at(-1).price, source: 'known' }
  return { price: null, source: null }
}

function buildPositions(ops, marketPrices, knownPrices, finalHoldings, mepRate) {
  const tickers = [...new Set(
    ops
      .filter(op => op.ticker && op.type !== 'IGNORAR' && op.type !== 'OTRO')
      .map(op => op.ticker)
  )]

  const currentQty = Object.fromEntries((finalHoldings ?? []).map(h => [h.ticker, h.qty]))

  const positions = []

  for (const ticker of tickers) {
    const buys = ops.filter(op =>
      op.ticker === ticker && (op.type === 'COMPRA' || op.type === 'SUSCRIPCION')
    )
    const sells = ops.filter(op =>
      op.ticker === ticker && (op.type === 'VENTA' || op.type === 'RESCATE')
    )

    if (buys.length === 0) continue

    // Weighted average buy price in ARS
    let totalQtyBought = 0
    let totalCostARS = 0
    for (const op of buys) {
      const qty = Math.abs(op.valorNominal ?? 0)
      if (!qty) continue
      totalCostARS += qty * toARSPrice(op)
      totalQtyBought += qty
    }
    if (totalQtyBought === 0) continue
    const avgBuyPriceARS = totalCostARS / totalQtyBought

    // Weighted average sell price in ARS
    let totalQtySold = 0
    let totalSaleARS = 0
    for (const op of sells) {
      const qty = Math.abs(op.valorNominal ?? 0)
      if (!qty) continue
      totalSaleARS += qty * toARSPrice(op)
      totalQtySold += qty
    }
    const avgSellPriceARS = totalQtySold > 0 ? totalSaleARS / totalQtySold : null

    const heldQty = currentQty[ticker] ?? 0
    const isClosed = heldQty === 0 && totalQtySold > 0

    // Current or sell price
    const { price: latestPriceARS } = getLatestMarketPrice(ticker, marketPrices, knownPrices)
    const valuationPriceARS = isClosed
      ? avgSellPriceARS
      : (latestPriceARS ?? avgBuyPriceARS) // fallback to cost if no price

    const priceChangeARS = valuationPriceARS != null
      ? valuationPriceARS - avgBuyPriceARS
      : null
    const priceChangePct = (priceChangeARS != null && avgBuyPriceARS > 0)
      ? (priceChangeARS / avgBuyPriceARS) * 100
      : null

    // P&L in ARS
    const unrealizedPnlARS = heldQty > 0 && latestPriceARS != null
      ? heldQty * (latestPriceARS - avgBuyPriceARS)
      : 0
    const realizedPnlARS = totalQtySold > 0
      ? totalQtySold * ((avgSellPriceARS ?? avgBuyPriceARS) - avgBuyPriceARS)
      : 0
    const totalPnlARS = unrealizedPnlARS + realizedPnlARS

    // P&L in USD
    const safeRate = mepRate ?? 1
    const unrealizedPnlUSD = unrealizedPnlARS / safeRate
    const realizedPnlUSD = realizedPnlARS / safeRate
    const totalPnlUSD = totalPnlARS / safeRate

    // Current value in USD
    const currentValueARS = heldQty > 0 && latestPriceARS != null
      ? heldQty * latestPriceARS
      : null
    const currentValueUSD = currentValueARS != null ? currentValueARS / safeRate : null

    positions.push({
      ticker,
      heldQty,
      totalQtyBought,
      totalQtySold,
      isClosed,
      avgBuyPriceARS,
      valuationPriceARS,
      priceChangePct,
      unrealizedPnlUSD,
      realizedPnlUSD,
      totalPnlUSD,
      currentValueUSD,
      hasPrice: latestPriceARS != null,
    })
  }

  return positions.sort((a, b) => b.totalPnlUSD - a.totalPnlUSD)
}

export default function RendimientoTab({
  ops,
  marketPrices,
  knownPrices,
  finalHoldings,
  mepRate,
  arsBalance,
  usdBalance,
}) {
  const positions = buildPositions(ops, marketPrices, knownPrices, finalHoldings, mepRate)

  // Total portfolio USD for contribution calculation
  const totalPortfolioUSD = positions.reduce((sum, p) => sum + (p.currentValueUSD ?? 0), 0)
    + (usdBalance ?? 0)
    + ((arsBalance ?? 0) / (mepRate ?? 1))

  const totalUnrealizedUSD = positions.reduce((s, p) => s + p.unrealizedPnlUSD, 0)
  const totalRealizedUSD   = positions.reduce((s, p) => s + p.realizedPnlUSD, 0)
  const totalPnlUSD        = totalUnrealizedUSD + totalRealizedUSD

  const openPositions   = positions.filter(p => !p.isClosed)
  const closedPositions = positions.filter(p => p.isClosed)

  function renderTable(rows, title) {
    if (rows.length === 0) return null
    return (
      <div className="bg-slate-800 rounded-2xl p-6 mb-4">
        <h3 className="text-white font-semibold mb-4">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="pb-2 text-left   text-xs text-slate-400 font-medium">Ticker</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Cantidad</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">P. Compra ARS</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">
                  {title.includes('Cerradas') ? 'P. Venta ARS' : 'P. Actual ARS'}
                </th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Var. %</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">P&L USD</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Contribución</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const contrib = totalPortfolioUSD > 0
                  ? (p.totalPnlUSD / totalPortfolioUSD) * 100
                  : null
                const pnl = p.isClosed ? p.realizedPnlUSD : p.unrealizedPnlUSD
                const isPos = (pnl ?? 0) >= 0
                const pctPos = (p.priceChangePct ?? 0) >= 0
                return (
                  <tr key={p.ticker} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2.5 font-mono text-blue-300 font-medium">{p.ticker}</td>
                    <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                      {fmt(p.isClosed ? p.totalQtySold : p.heldQty, 2)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-400 text-xs">
                      $ {fmt(p.avgBuyPriceARS, 2)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                      {p.valuationPriceARS != null ? `$ ${fmt(p.valuationPriceARS, 2)}` : '—'}
                    </td>
                    <td className={`py-2.5 text-right font-mono text-xs font-semibold
                        ${pctPos ? 'text-green-400' : 'text-red-400'}`}>
                      {p.priceChangePct != null
                        ? `${pctPos ? '+' : ''}${fmt(p.priceChangePct, 1)}%`
                        : '—'}
                    </td>
                    <td className={`py-2.5 text-right font-mono text-xs font-semibold
                        ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                      {pnl != null
                        ? `${isPos ? '+' : ''}US$ ${fmt(Math.abs(pnl), 0)}`
                        : '—'}
                    </td>
                    <td className={`py-2.5 text-right font-mono text-xs
                        ${(contrib ?? 0) >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
                      {contrib != null
                        ? `${contrib >= 0 ? '+' : ''}${fmt(contrib, 1)}%`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: 'P&L Total',
            value: `${totalPnlUSD >= 0 ? '+' : ''}US$ ${fmt(totalPnlUSD, 0)}`,
            cls: totalPnlUSD >= 0 ? 'text-green-400' : 'text-red-400',
          },
          {
            label: 'No realizado',
            value: `${totalUnrealizedUSD >= 0 ? '+' : ''}US$ ${fmt(totalUnrealizedUSD, 0)}`,
            cls: totalUnrealizedUSD >= 0 ? 'text-green-400' : 'text-red-400',
          },
          {
            label: 'Realizado',
            value: `${totalRealizedUSD >= 0 ? '+' : ''}US$ ${fmt(totalRealizedUSD, 0)}`,
            cls: totalRealizedUSD >= 0 ? 'text-green-400' : 'text-red-400',
          },
          {
            label: 'Mejor posición',
            value: positions[0]?.ticker ?? '—',
            cls: 'text-blue-300 font-mono',
            sub: positions[0]
              ? `+US$ ${fmt(positions[0].totalPnlUSD, 0)}`
              : '',
          },
        ].map(({ label, value, cls, sub }) => (
          <div key={label} className="bg-slate-800 rounded-xl p-4">
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className={`text-xl font-bold font-mono ${cls}`}>{value}</p>
            {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {renderTable(openPositions,   'Posiciones abiertas')}
      {renderTable(closedPositions, 'Posiciones cerradas')}

      {positions.length === 0 && (
        <div className="bg-slate-800 rounded-2xl p-8 text-center">
          <p className="text-slate-400">No hay posiciones para analizar.</p>
        </div>
      )}
    </div>
  )
}
