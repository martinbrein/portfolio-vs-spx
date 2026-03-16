import * as XLSX from 'xlsx'

function excelSerialToISO(serial) {
  // Excel dates are days since Dec 30, 1899
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  return d.toISOString().split('T')[0]
}

function parseDate(value) {
  if (typeof value === 'number' && value > 1000) {
    return excelSerialToISO(value)
  }
  if (value instanceof Date) {
    return value.toISOString().split('T')[0]
  }
  if (typeof value === 'string') {
    // DD/MM/YYYY
    const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    // MM/DD/YYYY
    const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
    // ISO or partial ISO
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
    // Try native parse
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }
  return null
}

export function parsePortfolioExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true })

        if (rows.length < 2) throw new Error('El archivo necesita al menos 2 filas de datos.')

        // Detect header row
        const startRow = (typeof rows[0][0] === 'string' && isNaN(parseFloat(rows[0][1]))) ? 1 : 0

        const result = []
        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i]
          if (!row || row.length < 2) continue
          const date = parseDate(row[0])
          const value = parseFloat(String(row[1]).replace(',', '.'))
          if (date && !isNaN(value) && value > 0) {
            result.push({ date, value })
          }
        }

        if (result.length < 5) throw new Error('No se encontraron suficientes datos válidos. Verificá el formato: columna A = Fecha, columna B = Valor.')

        result.sort((a, b) => a.date.localeCompare(b.date))
        resolve(result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo.'))
    reader.readAsArrayBuffer(file)
  })
}
