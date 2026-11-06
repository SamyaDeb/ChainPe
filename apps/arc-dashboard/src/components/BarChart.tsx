import type { Bar } from '@/lib/series'
import { formatUsdc, scaleToPixels } from '@/lib/money'
import { formatDay, formatHour } from '@/lib/time'

const WIDTH = 600
const HEIGHT = 160
const PLOT = 144

/** Verified revenue per period. Heights come from a bigint ratio; there is no per-rail split in the data. */
export function BarChart({ bars, unit }: { bars: Bar[]; unit: 'hour' | 'day' }) {
  const peak = bars.reduce((m, b) => (b.revenue > m ? b.revenue : m), 0n)
  const slot = WIDTH / bars.length
  const barWidth = Math.max(1, slot * 0.8)
  const fmt = unit === 'hour' ? formatHour : formatDay
  const first = bars[0]
  const last = bars[bars.length - 1]
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Verified revenue per ${unit}, ${bars.length} periods, highest ${formatUsdc(peak)}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <line x1="0" x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-line" strokeWidth="1" />
        {bars.map((b, i) => {
          const h = b.revenue > 0n ? Math.max(2, scaleToPixels(b.revenue, peak, PLOT)) : 0
          return (
            <rect
              key={b.t}
              x={i * slot + (slot - barWidth) / 2}
              y={HEIGHT - 1 - h}
              width={barWidth}
              height={h}
              rx="1"
              className="fill-accent"
            >
              <title>{`${fmt(b.t)}: ${formatUsdc(b.revenue)} verified, ${b.calls} ${b.calls === 1 ? 'call' : 'calls'}`}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted">
        <span>{first ? fmt(first.t) : ''}</span>
        <span>Peak {formatUsdc(peak)} per {unit}</span>
        <span>{last ? fmt(last.t) : ''}</span>
      </figcaption>
    </figure>
  )
}
