import { useState } from 'react'
import type { Buyer, Range } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { RangePicker } from '@/components/RangePicker'
import { AddressView } from '@/components/ui/Address'
import { Note, PageHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { formatUsdc } from '@/lib/money'
import { formatDateTime } from '@/lib/time'

export function Buyers() {
  const { api } = useAuth()
  const [range, setRange] = useState<Range>('all')
  const buyers = useResource(`buyers-${range}`, () => api.buyers(range))

  const columns: Array<Column<Buyer>> = [
    { header: 'Buyer', cell: (b) => <AddressView address={b.address} /> },
    { header: 'Verified spend', cell: (b) => <span className="font-display text-2xl tracking-tight">{formatUsdc(b.spendAtomic)}</span> },
    { header: 'Calls', cell: (b) => <span className="tabular-nums">{b.calls}</span> },
    { header: 'First seen', cell: (b) => formatDateTime(b.firstSeen) },
    { header: 'Last seen', cell: (b) => formatDateTime(b.lastSeen) },
  ]

  return (
    <>
      <PageHeader title="Buyers" subtitle="Every wallet that paid you, by verified spend." />
      <div className="mb-8">
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="flex flex-col gap-6">
        <ResourceView
          resource={buyers}
          isEmpty={(d) => d.buyers.length === 0}
          empty={<EmptyState title="No buyers yet" body="A buyer appears after a verified payment reaches you." command="chainpe start" />}
        >
          {(d) => (
            <>
              <p className="font-mono text-sm text-muted">
                Showing {d.buyers.length} of {d.totalBuyers} {d.totalBuyers === 1 ? 'buyer' : 'buyers'}.
              </p>
              <DataTable caption="Buyers by verified spend" columns={columns} rows={d.buyers} rowKey={(b) => b.address} />
              <Note>Verified means money from that payer reached you. It does not prove an independent customer.</Note>
            </>
          )}
        </ResourceView>
      </div>
    </>
  )
}
