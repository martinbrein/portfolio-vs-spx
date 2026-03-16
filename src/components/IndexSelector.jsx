import { INDICES } from '../utils/indices'

const INDEX_KEYS = ['SPX', 'DJI', 'NASDAQ', 'MERVAL']

export default function IndexSelector({ selected, onChange, loading }) {
  return (
    <div className="flex gap-1">
      {INDEX_KEYS.map((key) => (
        <button
          key={key}
          onClick={() => !loading && onChange(key)}
          disabled={loading}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors
            ${selected === key
              ? 'bg-orange-500 text-white'
              : 'text-slate-400 hover:text-white hover:bg-slate-700'
            } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {INDICES[key].label}
        </button>
      ))}
    </div>
  )
}
