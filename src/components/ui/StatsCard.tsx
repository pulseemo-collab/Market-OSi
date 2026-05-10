'use client'

import { motion } from 'framer-motion'

interface StatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple'
  trend?: { value: string; positive: boolean }
}

const colorMap = {
  blue: {
    bg: 'bg-blue-50',
    icon: 'text-blue-600',
    badge: 'bg-blue-100 text-blue-700',
  },
  green: {
    bg: 'bg-green-50',
    icon: 'text-green-600',
    badge: 'bg-green-100 text-green-700',
  },
  yellow: {
    bg: 'bg-yellow-50',
    icon: 'text-yellow-600',
    badge: 'bg-yellow-100 text-yellow-700',
  },
  red: {
    bg: 'bg-red-50',
    icon: 'text-red-600',
    badge: 'bg-red-100 text-red-700',
  },
  purple: {
    bg: 'bg-purple-50',
    icon: 'text-purple-600',
    badge: 'bg-purple-100 text-purple-700',
  },
}

export default function StatsCard({ title, value, subtitle, icon, color = 'blue', trend }: StatsCardProps) {
  const colors = colorMap[color]

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className="card p-5"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
          )}
          {trend && (
            <span className={`inline-flex items-center text-xs font-medium mt-2 px-2 py-0.5 rounded-full ${
              trend.positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </span>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0 ml-4`}>
          <span className={`text-xl ${colors.icon}`}>{icon}</span>
        </div>
      </div>
    </motion.div>
  )
}
