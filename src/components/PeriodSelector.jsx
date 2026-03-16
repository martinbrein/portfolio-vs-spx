const PERIODS = ['1M', '3M', '6M', 'YTD', '1A', '3A', 'MAX']

export default function PeriodSelector({ selected, onChange }) {
  return (
    <div className="flex gap-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors
            ${selected === p
              ? 'bg-blue-500 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
        >
          {p}
        </button>
      ))}
    </div>
  )
}
