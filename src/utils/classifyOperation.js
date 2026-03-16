/**
 * Operation types:
 * - COMPRA        Buy security
 * - VENTA         Sell security
 * - SUSCRIPCION   FCI subscription
 * - RESCATE       FCI redemption
 * - DIVIDENDO     Cash dividend
 * - CUPON         Coupon payment
 * - AMORTIZACION  Bond amortization (partial repayment)
 * - DEPOSITO      External cash inflow (ECF IN)
 * - RETIRO        External cash outflow (ECF OUT)
 * - TRANSFER_TIT  Securities transfer
 * - IGNORAR       Internal block/unblock, to skip
 * - OTRO          Unclassified
 */

function extractTickerFromBoleto(detalle) {
  // Pattern: "Boleto / 338072 / COMPRA / 1 / TICKER / $"
  const parts = detalle.split('/')
  if (parts.length >= 5) {
    return parts[4].trim().replace(/\s*\/.*$/, '').trim()
  }
  return null
}

function extractTickerAfterSlash(detalle, keyword) {
  // Pattern: "Dividendo en efectivo / TICKER"
  const idx = detalle.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) return null
  const after = detalle.slice(idx + keyword.length).replace(/^\s*\/\s*/, '').trim()
  return after.split('/')[0].trim() || null
}

const IGNORE_PATTERNS = [
  /bloqueo monetario/i,
  /desbloqueo monetario/i,
  /saldo anterior/i,
]

export function classifyOperation(detalle, valorNominal, importeNeto) {
  const d = detalle.trim()

  // Ignore list
  if (IGNORE_PATTERNS.some((p) => p.test(d))) {
    return { type: 'IGNORAR', ticker: null, isECF: false }
  }

  // Boleto operations
  if (/^boleto\s*\//i.test(d)) {
    const parts = d.split('/')
    const opCode = (parts[2] || '').trim().toUpperCase()
    const ticker = extractTickerFromBoleto(d)

    if (['COMPRA', 'SCOMP', 'COMPRA-MEP'].includes(opCode)) {
      return { type: 'COMPRA', ticker, isECF: false }
    }
    if (['VENTA', 'SVENTA', 'VENTA-MEP'].includes(opCode)) {
      return { type: 'VENTA', ticker, isECF: false }
    }
    if (['SUSCOMPRA', 'SUSC'].includes(opCode)) {
      return { type: 'SUSCRIPCION', ticker, isECF: false }
    }
    if (['VSBNG', 'VSBON', 'VTABONO', 'VTABNG'].includes(opCode)) {
      // Sell via boleto (bond sell or similar)
      return { type: importeNeto > 0 ? 'VENTA' : 'COMPRA', ticker, isECF: false }
    }
    // Fallback for unknown boleto codes: use sign of importe/valorNominal
    const isBuy = valorNominal > 0 || importeNeto < 0
    return { type: isBuy ? 'COMPRA' : 'VENTA', ticker, isECF: false }
  }

  // FCI rescate / suscripción (liquidación)
  if (/liquidaci[oó]n\s*de\s*rescate/i.test(d)) {
    const ticker = d.split('/').slice(2).join('/').trim() || d
    return { type: 'RESCATE', ticker: ticker.split('/')[0].trim(), isECF: false }
  }
  if (/liquidaci[oó]n\s*de\s*suscripci[oó]n/i.test(d)) {
    const ticker = d.split('/').slice(2).join('/').trim() || d
    return { type: 'SUSCRIPCION', ticker: ticker.split('/')[0].trim(), isECF: false }
  }

  // Dividendo
  if (/dividendo\s*en\s*efectivo/i.test(d)) {
    const ticker = extractTickerAfterSlash(d, 'dividendo en efectivo')
    return { type: 'DIVIDENDO', ticker, isECF: false }
  }

  // Cupon / Renta (intereses de bonos)
  if (/cobro\s*de\s*cup[oó]n/i.test(d) || /cup[oó]n/i.test(d) || /^renta\s*\//i.test(d)) {
    const ticker = extractTickerAfterSlash(d, '/')
    return { type: 'CUPON', ticker, isECF: false }
  }

  // Amortizacion
  if (/amortizaci[oó]n/i.test(d)) {
    const ticker = extractTickerAfterSlash(d, '/')
    return { type: 'AMORTIZACION', ticker, isECF: false }
  }

  // Split
  if (/split/i.test(d)) {
    const ticker = extractTickerAfterSlash(d, '/')
    return { type: 'SPLIT', ticker, isECF: false }
  }

  // Transfer de títulos
  if (/transferencia\s*de\s*t[ií]tulos/i.test(d)) {
    const isIn = importeNeto > 0 || valorNominal > 0
    return { type: 'TRANSFER_TIT', ticker: null, isECF: true, ecfDirection: isIn ? 'IN' : 'OUT' }
  }

  // Retiro / Comprobante de Pago
  if (/comprobante\s*de\s*pago/i.test(d) || /pago\s*a\s*acreedor/i.test(d)) {
    return { type: 'RETIRO', ticker: null, isECF: true, ecfDirection: 'OUT' }
  }

  // Deposito / Ingreso / Acreditacion / Recibo de Cobro
  if (/acreditaci[oó]n/i.test(d) || /ingreso/i.test(d) || /dep[oó]sito/i.test(d) || /recibo\s*de\s*cobro/i.test(d)) {
    return { type: 'DEPOSITO', ticker: null, isECF: true, ecfDirection: 'IN' }
  }

  // Comprobante sin código claro: usar sign
  if (/comprobante/i.test(d)) {
    const isOut = importeNeto < 0
    return { type: isOut ? 'RETIRO' : 'DEPOSITO', ticker: null, isECF: true, ecfDirection: isOut ? 'OUT' : 'IN' }
  }

  return { type: 'OTRO', ticker: null, isECF: false }
}

export const OPERATION_LABELS = {
  COMPRA: 'Compra',
  VENTA: 'Venta',
  SUSCRIPCION: 'Suscripción FCI',
  RESCATE: 'Rescate FCI',
  DIVIDENDO: 'Dividendo',
  CUPON: 'Cobro Cupón',
  AMORTIZACION: 'Amortización',
  DEPOSITO: 'Depósito',
  RETIRO: 'Retiro',
  TRANSFER_TIT: 'Transfer Títulos',
  SPLIT: 'Split',
  IGNORAR: 'Interno',
  OTRO: 'Otro',
}

export const OPERATION_COLORS = {
  COMPRA: 'text-blue-400',
  VENTA: 'text-orange-400',
  SUSCRIPCION: 'text-blue-300',
  RESCATE: 'text-orange-300',
  DIVIDENDO: 'text-green-400',
  CUPON: 'text-green-300',
  AMORTIZACION: 'text-green-300',
  DEPOSITO: 'text-emerald-400',
  RETIRO: 'text-red-400',
  TRANSFER_TIT: 'text-purple-400',
  SPLIT: 'text-yellow-400',
  IGNORAR: 'text-slate-600',
  OTRO: 'text-slate-500',
}
