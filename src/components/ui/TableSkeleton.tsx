'use client'

const WIDTHS = ['w-32', 'w-24', 'w-20', 'w-28', 'w-16', 'w-24', 'w-20', 'w-16']

export default function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse" aria-label="Duke ngarkuar...">
      <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={`h-3 bg-slate-200 rounded ${WIDTHS[i % WIDTHS.length]}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="border-b border-slate-100 px-4 py-4 flex gap-6 items-center">
          {Array.from({ length: cols }).map((_, colIdx) => (
            <div
              key={colIdx}
              className={`h-4 bg-slate-100 rounded ${WIDTHS[(colIdx + rowIdx) % WIDTHS.length]}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
