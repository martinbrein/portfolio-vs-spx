import * as XLSX from 'xlsx'
import { classifyOperation } from './classifyOperation'

function parseDate(val) {
  if (!val || val === '') return null
  if (typeof val === 'string') {
    const dmy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
  }
  if (val instanceof Date) return val.toISOString().split('T')[0]
  if (typeof val === 'number' && val > 40000) {
    const ms = (val - 25569) * 86400 * 1000
    return new Date(ms).toISOString().split('T')[0]
  }
  return null
}

function parseNum(val) {
  if (val === '' || val == null) return null
  const n = parseFloat(String(val).replace(',', '.').replace(/\s/g, ''))
  return isNaN(n) ? null : n
}

/**
 * Detect section headers that mark currency context.
 * Allaria has 3 settlement currencies:
 *   ARS        → "Pesos - $"
 *   USD_MEP    → "MEP Dólar - M"
 *   USD_CABLE  → "Dólar - U$S" (cable)
 * "Disponible" / "No Disponible" sub-groupings are ignored — they don't affect ops.
 */
function detectSection(row) {
  const cell = String(row[0] || '').toLowerCase().trim()
  if (!cell) return null

  // Must have no detalle (col2 empty) to be a section header
  if (String(row[2] || '').trim()) return null

  if (/pesos|^-?\s*\$/.test(cell)) return 'ARS'
  if (/mep/.test(cell)) return 'USD_MEP'
  if (/u\$s|cable/.test(cell)) return 'USD_CABLE'
  if (/d[oó]lar/.test(cell) && !/mep/.test(cell)) return 'USD_CABLE'

  return null
}

export function parseAllariaXLS(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

        const ops = []
        const mepRatesFromOps = {}  // { date: mepRate } extracted from tipoCambio
        let currentCurrency = 'ARS'

        // Track boleto numbers seen in USD sections.
        // When the same boleto appears in the ARS section it's a commission/fee
        // charged in pesos for a USD trade — not a separate buy/sell operation.
        const usdBoletos = new Set()

        for (const row of rows) {
          // Skip header row
          if (String(row[0]).includes('Fecha') && String(row[2]).includes('Detalle')) continue

          // Detect section headers (currency change)
          const section = detectSection(row)
          if (section) {
            currentCurrency = section
            continue
          }

          // Skip sub-section labels (Saldo Anterior, empty rows)
          const detalle = String(row[2] || '').trim()
          if (!detalle || detalle === 'Saldo Anterior') continue

          const fechaConcertacion = parseDate(row[0])
          const fechaLiquidacion = parseDate(row[1])

          // Skip rows without a valid trade date
          if (!fechaConcertacion) continue

          // Extract boleto number from detalle (e.g. "Boleto / 822175 / COMPRA / ...")
          const boletoMatch = detalle.match(/^Boleto\s*\/\s*(\d+)/i)
          const boletoNum = boletoMatch ? boletoMatch[1] : null

          // Register USD boletos so we can detect ARS duplicates later
          if ((currentCurrency === 'USD_MEP' || currentCurrency === 'USD_CABLE') && boletoNum) {
            usdBoletos.add(boletoNum)
          }

          // Skip ARS rows that share a boleto with a USD trade: these are pesos
          // commissions/fees for that USD operation, not separate transactions.
          if (currentCurrency === 'ARS' && boletoNum && usdBoletos.has(boletoNum)) {
            continue
          }

          const valorNominal = parseNum(row[3])
          const precio = parseNum(row[4])
          const tipoCambio = parseNum(row[5]) ?? 1
          const importeNeto = parseNum(row[6])
          const nroDoc = String(row[7] || '').trim()
          const saldo = parseNum(row[8])

          // Extract MEP rate from USD_MEP section's tipoCambio (ARS per USD)
          if (currentCurrency === 'USD_MEP' && tipoCambio > 1 && fechaConcertacion) {
            mepRatesFromOps[fechaConcertacion] = tipoCambio
          }

          const classified = classifyOperation(detalle, valorNominal, importeNeto)

          ops.push({
            date: fechaConcertacion,
            settlementDate: fechaLiquidacion,
            detalle,
            currency: currentCurrency,
            valorNominal,
            precio,
            tipoCambio,
            importeNeto,
            nroDoc,
            saldo,
            ...classified,
          })
        }

        if (ops.length === 0) {
          throw new Error('No se encontraron operaciones en el archivo. Verificá que sea el extracto de cuenta corriente de Allaria.')
        }

        resolve({ ops, mepRatesFromOps })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo.'))
    reader.readAsArrayBuffer(file)
  })
}
