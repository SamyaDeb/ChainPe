import { useState } from 'react'
import type { Buyer, Range } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { useMe } from '@/auth/useMe'
import { RangePicker } from '@/components/RangePicker'
import { AddressView } from '@/components/ui/Address'
import { Note, PageHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { formatUsdc } from '@/lib/money'
import { formatDateTime } from '@/lib/time'

export function Buyers() {
  const me = useMe()
  const { api } = useAuth()
  const pro = me.plan === 'pro'
  const [range, setRange] = useState<Range>(pro ? 'all' : '7d')
  const buyers = useResource(`buyers-${range}`, () => api.buyers(range))

  const columns: Array<Column<Buyer>> = [
    { header: 'Buyer', cell: (b) => <AddressView address={b.address} /> },
    { header: 'Verified spend', cell: (b) => <span className="font-display text-2xl tracking-tight">{formatUsdc(b.spendAtomic)}</span> },
    { header: 'Calls', cell: (b) => <span className="tabular-nums">{b.calls}</span> },
    ...(pro
      ? [
          { header: 'First seen', cell: (b: Buyer) => formatDateTime(b.firstSeen) },
          { header: 'Last seen', cell: (b: Buyer) => formatDateTime(b.lastSeen) },
        ]
      : []),
  ]

  return (
    <>
      <PageHeader title="Buyers" subtitle={pro ? 'Every wallet that paid you, by verified spend.' : 'Free shows your top 5 buyers.'} />
      <div className="mb-8">
        <RangePicker value={range} plan={me.plan} onChange={setRange} />
      </div>
      <div className="flex flex-col gap-6">
        <ResourceView
          resource={buyers}
          locked={<LockedCard feature="Longer time ranges" description="30 days, 90 days and all time are part of the Pro plan." />}
          isEmpty={(d) => d.buyers.length === 0}
          empty={<EmptyState title="No buyers yet" body="A buyer appears after a verified payment reaches you." command="chainpe start" />}
        >
          {(d) => (
            <>
              <p className="font-mono text-sm text-muted">
                Showing {d.buyers.length} of {d.totalBuyers} {d.totalBuyers === 1 ? 'buyer' : 'buyers'}.
              </p>
              <DataTable caption="Buyers by verified spend" columns={columns} rows={d.buyers} rowKey={(b) => b.address} />
              {d.truncated ? <LockedCard feature="All buyers" description="Pro lists every buyer with first and last seen." /> : null}
              <Note>Verified means money from that payer reached you. It does not prove an independent customer.</Note>
            </>
          )}
        </ResourceView>
      </div>
    </>
  )
}
