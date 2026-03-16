import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

function tickDate(str, days) {
  try {
    const d = parseISO(str)
    if (days <= 90) return format(d, 'd MMM', { locale: es })
    if (days <= 730) return format(d, 'MMM yy', { locale: es })
    return format(d, 'yyyy')
  } catch {
    return str
  }
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 text-sm shadow-lg">
      <p className="text-slate-400 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono font-medium" style={{ color: p.color }}>
            {p.value >= 0 ? '+' : ''}{p.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function CumulativeChart({ data, days }) {
  if (!data?.length) return null
  const interval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h3 className="text-white font-semibold mb-4">Retorno acumulado</h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v) => tickDate(v, days)}
            interval={interval}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: 13 }}
            formatter={(val) => val === 'portfolio' ? 'Portfolio' : 'S&P 500'}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
          <Line
            type="monotone"
            dataKey="portfolio"
            name="portfolio"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#60a5fa' }}
          />
          <Line
            type="monotone"
            dataKey="spx"
            name="spx"
            stroke="#fb923c"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#fb923c' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
