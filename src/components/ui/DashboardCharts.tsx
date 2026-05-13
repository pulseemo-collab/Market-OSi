'use client'

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface TooltipPayload {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}

function ChartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-sm">
      <p className="text-xs font-semibold text-slate-500 mb-2">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-medium" style={{ color: p.color }}>
          {p.name === 'shitjet' ? 'Shitjet' : p.name === 'fitimi' ? 'Fitimi' : p.name}:{' '}
          <span className="font-bold">{p.value.toLocaleString('sq-AL')} L</span>
        </p>
      ))}
    </div>
  )
}

interface DailyPoint {
  data: string
  shitjet: number
  fitimi: number
}

interface MonthlyPoint {
  muaj: string
  shitjet: number
  fitimi: number
}

interface ProductPoint {
  emri: string
  njesi: number
  fitimi: number
}

export function DailySalesChart({ data }: { data: DailyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="gradShitjet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradFitimi" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="data"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          interval={4}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          width={32}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v) => (v === 'shitjet' ? 'Shitjet' : 'Fitimi')}
        />
        <Area
          type="monotone"
          dataKey="shitjet"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#gradShitjet)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="fitimi"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#gradFitimi)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MonthlySalesChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="muaj"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          width={32}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(v) => (v === 'shitjet' ? 'Shitjet' : 'Fitimi')}
        />
        <Bar dataKey="shitjet" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="fitimi" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TopProductsChart({ data }: { data: ProductPoint[] }) {
  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-sm text-slate-400">
      Nuk ka të dhëna për këtë periudhë
    </div>
  )
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          type="category"
          dataKey="emri"
          tick={{ fontSize: 11, fill: '#475569' }}
          tickLine={false}
          axisLine={false}
          width={110}
        />
        <Tooltip
          formatter={(value) => [`${value} njësi`, 'Shitur']}
          contentStyle={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        />
        <Bar dataKey="njesi" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  )
}
