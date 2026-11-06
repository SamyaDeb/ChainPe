import type { PlanName, Range } from '@/api/schema'
import { Segmented } from './ui/forms'

const LABELS: Record<Range, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' }
const ORDER: Range[] = ['24h', '7d', '30d', '90d', 'all']

/** Free covers 24h and 7d. The other ranges are offered with a Pro mark and the API decides. */
export function RangePicker({ value, plan, onChange }: { value: Range; plan: PlanName; onChange: (r: Range) => void }) {
  return (
    <Segmented
      label="Time range"
      value={value}
      onChange={onChange}
      options={ORDER.map((r) => ({ value: r, label: LABELS[r], locked: plan === 'free' && r !== '24h' && r !== '7d' }))}
    />
  )
}
