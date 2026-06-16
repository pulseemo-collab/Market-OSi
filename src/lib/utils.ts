export function formatCurrency(amount: number): string {
  return `${amount.toFixed(0)} L`
}

export function formatDate(date: string | Date): string {
  const d = new Date(date)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatTime(date: string | Date): string {
  const d = new Date(date)
  return d.toLocaleTimeString('sq-AL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeTime(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Tani'
  if (minutes < 60) return `${minutes} min më parë`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} orë më parë`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ditë më parë`
  return formatDateTime(date)
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
