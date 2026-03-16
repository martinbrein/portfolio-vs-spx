import { useRef, useState } from 'react'

export default function UploadSection({ onFile, loading }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  function handleFile(file) {
    if (!file) return
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      alert('Solo se aceptan archivos Excel (.xlsx o .xls)')
      return
    }
    onFile(file)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Portfolio vs S&P 500</h1>
        <p className="text-slate-400">Subí tu valuación diaria en USD y compará contra el índice</p>
      </div>

      <div
        className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragging ? 'border-blue-400 bg-blue-400/10' : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFile(e.dataTransfer.files[0])
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-slate-300">Cargando datos del S&P 500...</p>
          </div>
        ) : (
          <>
            <div className="text-5xl mb-4">📊</div>
            <p className="text-white font-medium mb-1">Arrastrá o hacé click para subir tu Excel</p>
            <p className="text-slate-400 text-sm">Formato: columna A = Fecha · columna B = Valor en USD</p>
          </>
        )}
      </div>

      <div className="mt-6 bg-slate-800 rounded-xl p-4 max-w-lg w-full text-left">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Ejemplo de formato</p>
        <div className="grid grid-cols-2 gap-2 text-sm font-mono">
          <span className="text-slate-500">Fecha</span>
          <span className="text-slate-500">Valor USD</span>
          <span className="text-slate-300">01/01/2023</span>
          <span className="text-slate-300">100,000</span>
          <span className="text-slate-300">02/01/2023</span>
          <span className="text-slate-300">101,500</span>
          <span className="text-slate-300">03/01/2023</span>
          <span className="text-slate-300">99,800</span>
        </div>
      </div>
    </div>
  )
}
