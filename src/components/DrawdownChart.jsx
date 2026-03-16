import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
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
          <span className="font-mono font-medium text-red-400">
            {p.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default function DrawdownChart({ data, days, benchmarkLabel = 'S&P 500' }) {
  if (!data?.length) return null
  const interval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div className="bg-slate-800 rounded-2xl p-6">
      <h3 className="text-white font-semibold mb-4">Drawdown</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
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
            tickFormatter={(v) => `${v.toFixed(0)}%`}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: 13 }}
            formatter={(val) => val === 'portfolio' ? 'Portfolio' : benchmarkLabel}
          />
          <Area
            type="monotone"
            dataKey="portfolio"
            name="portfolio"
            stroke="#60a5fa"
            fill="#60a5fa22"
            strokeWidth={1.5}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="spx"
            name="spx"
            stroke="#fb923c"
            fill="#fb923c22"
            strokeWidth={1.5}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
