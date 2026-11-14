const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const dateOnly = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const hourOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '\u2014' : dateTime.format(t)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '\u2014' : dateOnly.format(t)
}

export function formatHour(ms: number): string {
  return hourOnly.format(ms)
}

export function formatDay(ms: number): string {
  return dateOnly.format(ms)
}

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

export const ONLINE_WINDOW_MS = 10 * 60 * 1000
