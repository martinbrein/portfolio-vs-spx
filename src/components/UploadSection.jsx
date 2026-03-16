import { useRef, useState } from 'react'

export default function UploadSection({ onFile, loading, loadingStep }) {
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
        <p className="text-slate-400">Subí tu extracto de cuenta corriente de Allaria para calcular el TWR</p>
      </div>

      <div
        className={`w-full max-w-lg border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragging ? 'border-blue-400 bg-blue-400/10' : 'border-slate-600 bg-slate-800/50 hover:border-slate-500'}`}
        onClick={() => !loading && inputRef.current?.click()}
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
            <p className="text-slate-300 text-sm">{loadingStep || 'Procesando...'}</p>
          </div>
        ) : (
          <>
            <div className="text-5xl mb-4">📊</div>
            <p className="text-white font-medium mb-1">Arrastrá o hacé click para subir</p>
            <p className="text-slate-400 text-sm">Extracto de cuenta corriente Allaria (.xls / .xlsx)</p>
          </>
        )}
      </div>

      <div className="mt-6 bg-slate-800 rounded-xl p-5 max-w-lg w-full text-left space-y-3">
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Cómo descargar el extracto</p>
        <ol className="text-slate-300 text-sm space-y-1 list-decimal list-inside">
          <li>Ingresá a <span className="text-blue-400">Mi Cuenta en Allaria</span></li>
          <li>Ir a <span className="text-white font-medium">Cuenta Corriente → Monetaria</span></li>
          <li>Seleccioná el período <span className="text-white font-medium">desde la apertura de la cuenta</span> hasta hoy</li>
          <li>Exportar como <span className="text-white font-medium">Excel (.xls)</span></li>
        </ol>
        <p className="text-slate-500 text-xs">
          ⚠ Para calcular el TWR correctamente necesitás el historial completo desde el inicio.
        </p>
      </div>
    </div>
  )
}
