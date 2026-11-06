import type { Range, SummaryPoint } from '@/api/schema'
import { parseAtomic } from './money'

export interface Bar {
  /** Start of the period, ms since epoch (UTC aligned). */
  t: number
  revenue: bigint
  calls: number
}

const RANGE_MS: Record<Range, number | null> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  all: null,
}

const MAX_BARS = 400

/**
 * The API returns only periods that had events. Fill the gaps with zero so the chart keeps a true time axis.
 */
export function fillSeries(
  points: SummaryPoint[],
  unit: 'hour' | 'day',
  since: string | null,
  range: Range,
  now: number,
): Bar[] {
  const step = unit === 'hour' ? 3_600_000 : 86_400_000
  const floor = (ms: number) => Math.floor(ms / step) * step
  const byTime = new Map<number, Bar>()
  for (const p of points) {
    const ms = Date.parse(p.t)
    if (Number.isNaN(ms)) continue
    const t = floor(ms)
    const prev = byTime.get(t)
    const revenue = parseAtomic(p.revenueAtomic) ?? 0n
    byTime.set(t, { t, revenue: (prev?.revenue ?? 0n) + revenue, calls: (prev?.calls ?? 0) + p.calls })
  }
  if (byTime.size === 0) return []

  const times = [...byTime.keys()]
  const first = Math.min(...times)
  const last = Math.max(...times)
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const span = RANGE_MS[range]

  let start = Number.isNaN(sinceMs) ? first : floor(sinceMs)
  let end = !Number.isNaN(sinceMs) && span !== null ? floor(Math.min(now, sinceMs + span)) : floor(now)
  start = Math.min(start, first)
  end = Math.max(end, last)
  if ((end - start) / step + 1 > MAX_BARS) start = end - (MAX_BARS - 1) * step

  const bars: Bar[] = []
  for (let t = start; t <= end; t += step) bars.push(byTime.get(t) ?? { t, revenue: 0n, calls: 0 })
  return bars
}
