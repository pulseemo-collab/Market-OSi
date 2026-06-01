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
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

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

const PAYMENT_COLORS = ['#10b981', '#8b5cf6']

export function PaymentDonutChart({ cash, bank }: { cash: number; bank: number }) {
  const total = cash + bank
  const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0
  const bankPct = total > 0 ? 100 - cashPct : 0

  const pieData =
    total > 0
      ? [
          { name: 'Cash', value: cash },
          { name: 'Bankë / Kartë', value: bank },
        ]
      : [{ name: 'Pa të dhëna', value: 1 }]

  const isEmpty = total === 0

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
      {/* Donut */}
      <div className="relative flex-shrink-0">
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={54}
              outerRadius={80}
              dataKey="value"
              strokeWidth={2}
              stroke="#fff"
              startAngle={90}
              endAngle={-270}
            >
              {pieData.map((_, i) => (
                <Cell
                  key={i}
                  fill={isEmpty ? '#e2e8f0' : PAYMENT_COLORS[i] ?? PAYMENT_COLORS[0]}
                />
              ))}
            </Pie>
            {!isEmpty && (
              <Tooltip
                formatter={(value, name) => [
                  `${formatCurrency(Number(value))} (${name === 'Cash' ? cashPct : bankPct}%)`,
                  name as string,
                ]}
                contentStyle={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                }}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {isEmpty ? (
            <span className="text-xs text-slate-400 text-center px-2">Nuk ka<br />të dhëna</span>
          ) : (
            <>
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Gjithsej</span>
              <span className="text-sm font-bold text-slate-900 mt-0.5">{formatCurrency(total)}</span>
            </>
          )}
        </div>
      </div>

      {/* Legend + stats */}
      <div className="flex-1 w-full space-y-4">
        {/* Cash row */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-slate-700">Cash</span>
            </div>
            <span className="text-sm font-bold text-emerald-600">{cashPct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${cashPct}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{formatCurrency(cash)}</p>
        </div>

        {/* Bank row */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-slate-700">Bankë / Kartë</span>
            </div>
            <span className="text-sm font-bold text-violet-600">{bankPct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-500"
              style={{ width: `${bankPct}%` }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{formatCurrency(bank)}</p>
        </div>
      </div>
    </div>
  )
}
