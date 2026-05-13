export function formatCurrency(amount: number): string {
  return `${amount.toFixed(0)} L`
}

export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleDateString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleTimeString('sq-AL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isLowStock(sasia: number, stokuMinimal: number): boolean {
  return sasia <= stokuMinimal
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function toArray<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[]
  if (key && data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, unknown>)[key] as T[]
  }
  return []
}
