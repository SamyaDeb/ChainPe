import type { Range } from '@/api/schema'
import { Segmented } from './ui/forms'

const LABELS: Record<Range, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' }
const ORDER: Range[] = ['24h', '7d', '30d', '90d', 'all']

/** Every range is open on Avalanche, which has no paid plan. */
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <Segmented
      label="Time range"
      value={value}
      onChange={onChange}
      options={ORDER.map((r) => ({ value: r, label: LABELS[r] }))}
    />
  )
}
