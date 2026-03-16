/**
 * RendimientoTab — per-asset performance analysis.
 * Shows for each ticker:
 *  - Average buy price (ARS)
 *  - Current or sell price (ARS)
 *  - Price change %
 *  - Price-based P&L in USD (capital gains/losses only)
 *  - Income in USD (dividends, coupons, amortizations)
 *  - Total P&L = price P&L + income
 *  - Contribution to total portfolio P&L (%)
 */

function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/**
 * Convert operation price to ARS per unit.
 * Mirrors the logic in holdingsTracker — always returns ARS.
 *
 * For USD-section ops: use tipoCambio when it's a real rate (> 1),
 * otherwise fall back to mepRate (handles licitación primaria where TC ≤ 1).
 */
function toARSPrice(op, mepRate) {
  const price = op.precio
  const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'
  if (!price || price <= 0) {
    const qty = Math.abs(op.valorNominal ?? 0)
    if (!qty) return 0
    const unitPrice = Math.abs(op.importeNeto ?? 0) / qty
    // importeNeto for USD-section ops is in USD → convert to ARS
    return isUSD ? unitPrice * (mepRate ?? 1) : unitPrice
  }
  if (isUSD) {
    // Use tipoCambio from the row when it's a real ARS/USD rate; otherwise use current mepRate
    const tc = (op.tipoCambio ?? 1) > 1 ? op.tipoCambio : (mepRate ?? 1)
    return price < 5
      ? price * tc          // FCI / USD-at-par (e.g. LOC6O = 1.0 USD/unit)
      : (price / 100) * tc  // Bond % of par
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

function buildPositions(ops, marketPrices, knownPrices, finalHoldings, mepRate, mepRates) {
  const tickers = [...new Set(
    ops
      .filter(op => op.ticker && op.type !== 'IGNORAR' && op.type !== 'OTRO')
      .map(op => op.ticker)
  )]

  const currentQty = Object.fromEntries((finalHoldings ?? []).map(h => [h.ticker, h.qty]))

  // Build MEP lookup for historical income conversion
  const mepDatesSorted = Object.keys(mepRates ?? {}).sort()
  function lookupMEP(date) {
    const prior = mepDatesSorted.filter(d => d <= date).at(-1)
    return prior ? mepRates[prior] : (mepRate ?? 1)
  }

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
      totalCostARS += qty * toARSPrice(op, mepRate)
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
      totalSaleARS += qty * toARSPrice(op, mepRate)
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

    // Price-based P&L in ARS (capital gains only, excludes income)
    const unrealizedPnlARS = heldQty > 0 && latestPriceARS != null
      ? heldQty * (latestPriceARS - avgBuyPriceARS)
      : 0
    const realizedPnlARS = totalQtySold > 0
      ? totalQtySold * ((avgSellPriceARS ?? avgBuyPriceARS) - avgBuyPriceARS)
      : 0

    // Price-based P&L in USD
    const safeRate = mepRate ?? 1
    const unrealizedPnlUSD = unrealizedPnlARS / safeRate
    const realizedPnlUSD = realizedPnlARS / safeRate
    const pricePnlUSD = unrealizedPnlUSD + realizedPnlUSD

    // Income: dividends (DIVIDENDO), bond coupons (CUPON), amortizations (AMORTIZACION)
    // Each is converted to USD using the historical MEP rate on its date.
    const incomeOps = ops.filter(op =>
      op.ticker === ticker &&
      (op.type === 'DIVIDENDO' || op.type === 'CUPON' || op.type === 'AMORTIZACION')
    )
    let incomeUSD = 0
    for (const op of incomeOps) {
      const isUSD = op.currency === 'USD_MEP' || op.currency === 'USD_CABLE'
      const amount = Math.abs(op.importeNeto ?? 0)
      if (isUSD) {
        incomeUSD += amount
      } else {
        const rate = lookupMEP(op.date)
        incomeUSD += amount / rate
      }
    }

    // Total P&L per position = price gains/losses + income received
    const totalPnlUSD = pricePnlUSD + incomeUSD

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
      pricePnlUSD,
      incomeUSD,
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
  mepRates = {},
  arsBalance,
  usdBalance,
  portfolioValueUSD = null,
  netContributions = null,
}) {
  const positions = buildPositions(ops, marketPrices, knownPrices, finalHoldings, mepRate, mepRates)

  // Total portfolio USD for contribution % calculation
  const totalPortfolioUSD = positions.reduce((sum, p) => sum + (p.currentValueUSD ?? 0), 0)
    + (usdBalance ?? 0)
    + ((arsBalance ?? 0) / (mepRate ?? 1))

  const totalPricePnlUSD  = positions.reduce((s, p) => s + p.pricePnlUSD, 0)
  const totalIncomeUSD     = positions.reduce((s, p) => s + p.incomeUSD, 0)
  const totalAssetPnlUSD   = positions.reduce((s, p) => s + p.totalPnlUSD, 0)

  // True P&L = current portfolio value minus net contributions.
  const truePnlUSD = portfolioValueUSD != null && netContributions != null
    ? portfolioValueUSD - netContributions
    : null

  // Gap = true P&L minus sum of per-asset P&L (caución interest, conversion effects, etc.)
  const gapUSD = truePnlUSD != null ? truePnlUSD - totalAssetPnlUSD : null

  const openPositions   = positions.filter(p => !p.isClosed)
  const closedPositions = positions.filter(p => p.isClosed)

  function renderTable(rows, title) {
    if (rows.length === 0) return null
    const isClosedTable = title.includes('cerrada') || title.includes('Cerrada')
    return (
      <div className="bg-slate-800 rounded-2xl p-6 mb-4">
        <h3 className="text-white font-semibold mb-4">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="pb-2 text-left   text-xs text-slate-400 font-medium">Ticker</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Cantidad</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">P. Compra</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">
                  {isClosedTable ? 'P. Venta' : 'P. Actual'}
                </th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Var. %</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">P&L Precio</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">Ingresos</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium">P&L Total</th>
                <th className="pb-2 text-right  text-xs text-slate-400 font-medium" title="P&L total del activo como % del capital aportado">% Capital</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                // Contribution = position P&L as % of total invested capital.
                // Using netContributions (always positive) as denominator keeps
                // signs correct even when the overall portfolio P&L is negative.
                const base = netContributions ?? totalPortfolioUSD
                const contrib = base > 0 ? (p.totalPnlUSD / base) * 100 : null
                const pricePnl = isClosedTable ? p.realizedPnlUSD : p.unrealizedPnlUSD
                const pricePos = (pricePnl ?? 0) >= 0
                const incomePos = p.incomeUSD >= 0
                const totalPos = p.totalPnlUSD >= 0
                const pctPos = (p.priceChangePct ?? 0) >= 0
                return (
                  <tr key={p.ticker} className="border-t border-slate-700/50 hover:bg-slate-700/20">
                    <td className="py-2.5 font-mono text-blue-300 font-medium">{p.ticker}</td>
                    <td className="py-2.5 text-right font-mono text-slate-300 text-xs">
                      {fmt(isClosedTable ? p.totalQtySold : p.heldQty, 2)}
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
                    {/* Price-based P&L */}
                    <td className={`py-2.5 text-right font-mono text-xs
                        ${pricePos ? 'text-green-400' : 'text-red-400'}`}>
                      {pricePnl != null
                        ? `${pricePos ? '+' : ''}US$ ${fmt(Math.abs(pricePnl), 0)}`
                        : '—'}
                    </td>
                    {/* Income (dividends / coupons / amortizations) */}
                    <td className={`py-2.5 text-right font-mono text-xs
                        ${p.incomeUSD > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {p.incomeUSD > 0
                        ? `+US$ ${fmt(p.incomeUSD, 0)}`
                        : '—'}
                    </td>
                    {/* Total P&L = price + income */}
                    <td className={`py-2.5 text-right font-mono text-xs font-semibold
                        ${totalPos ? 'text-green-400' : 'text-red-400'}`}>
                      {`${totalPos ? '+' : ''}US$ ${fmt(Math.abs(p.totalPnlUSD), 0)}`}
                    </td>
                    {/* P&L as % of invested capital */}
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
            label: 'Ganancia / Pérdida',
            value: truePnlUSD != null
              ? `${truePnlUSD >= 0 ? '+' : ''}US$ ${fmt(Math.abs(truePnlUSD), 0)}`
              : '—',
            cls: truePnlUSD != null ? (truePnlUSD >= 0 ? 'text-green-400' : 'text-red-400') : 'text-slate-400',
            sub: 'valor de cartera − aportes netos',
          },
          {
            label: 'P&L por precio',
            value: `${totalPricePnlUSD >= 0 ? '+' : ''}US$ ${fmt(Math.abs(totalPricePnlUSD), 0)}`,
            cls: totalPricePnlUSD >= 0 ? 'text-green-400' : 'text-red-400',
            sub: 'cambio de precio de los activos',
          },
          {
            label: 'Ingresos',
            value: totalIncomeUSD > 0
              ? `+US$ ${fmt(totalIncomeUSD, 0)}`
              : `US$ ${fmt(totalIncomeUSD, 0)}`,
            cls: totalIncomeUSD >= 0 ? 'text-emerald-400' : 'text-red-400',
            sub: 'dividendos + cupones + amortiz.',
          },
          {
            label: gapUSD != null ? `Otros / No atribuido` : 'P&L Activos',
            value: gapUSD != null
              ? `${gapUSD >= 0 ? '+' : ''}US$ ${fmt(Math.abs(gapUSD), 0)}`
              : `${totalAssetPnlUSD >= 0 ? '+' : ''}US$ ${fmt(Math.abs(totalAssetPnlUSD), 0)}`,
            cls: (gapUSD ?? totalAssetPnlUSD) >= 0 ? 'text-slate-300' : 'text-orange-400',
            sub: gapUSD != null
              ? 'cauciones, efectos de conversión ARS'
              : 'suma precio + ingresos activos',
          },
        ].map(({ label, value, cls, sub }) => (
          <div key={label} className="bg-slate-800 rounded-xl p-4">
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className={`text-xl font-bold font-mono ${cls}`}>{value}</p>
            {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
          </div>
        ))}
      </div>

      {/* Reconciliation note */}
      {truePnlUSD != null && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-2.5 mb-4 text-xs text-slate-400 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-slate-500">Ganancia/Pérdida =</span>{' '}
            <span className={totalPricePnlUSD >= 0 ? 'text-green-400' : 'text-red-400'}>
              P&L precio ({totalPricePnlUSD >= 0 ? '+' : ''}US$ {fmt(Math.abs(totalPricePnlUSD), 0)})
            </span>
            {' + '}
            <span className="text-emerald-400">
              Ingresos (US$ {fmt(totalIncomeUSD, 0)})
            </span>
            {gapUSD != null && Math.abs(gapUSD) > 1 && (
              <>
                {' + '}
                <span className={Math.abs(gapUSD) > 100 ? 'text-orange-400' : 'text-slate-400'}>
                  Otros (US$ {fmt(gapUSD, 0)})
                </span>
              </>
            )}
            {' = '}
            <span className={truePnlUSD >= 0 ? 'text-green-400' : 'text-red-400'}>
              {truePnlUSD >= 0 ? '+' : ''}US$ {fmt(truePnlUSD, 0)}
            </span>
          </span>
        </div>
      )}

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
