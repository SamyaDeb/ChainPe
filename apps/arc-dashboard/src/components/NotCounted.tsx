import type { Summary } from '@/api/schema'
import { formatUsdc } from '@/lib/money'
import { Card, Note, SectionTitle } from './ui/Card'

/** Money that is shown but never added to revenue. */
export function NotCounted({ notRevenue }: { notRevenue: Summary['notRevenue'] }) {
  const rows: Array<[string, string, string]> = [
    ['Unverified', notRevenue.unverifiedAtomic, 'Reported by your proxy, not yet matched to a transfer.'],
    ['Failed', notRevenue.failedAtomic, 'Served, then the transfer failed.'],
    ['Self-pay', notRevenue.selfPayAtomic, 'Paid from your own wallets.'],
    ['Unattributed inflow', notRevenue.unattributedInflowAtomic, 'USDC with no matching call: faucet, withdrawals, --no-telemetry.'],
  ]
  return (
    <Card>
      <SectionTitle>Not counted as revenue</SectionTitle>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([label, value, why]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
            <div className="min-w-0">
              <dt className="text-sm font-medium text-ink">{label}</dt>
              <dd className="text-xs text-muted">{why}</dd>
            </div>
            <dd className="text-sm font-semibold tabular-nums text-ink">{formatUsdc(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3">
        <Note>Verified means money from that payer reached you. It does not prove an independent customer.</Note>
      </div>
    </Card>
  )
}
