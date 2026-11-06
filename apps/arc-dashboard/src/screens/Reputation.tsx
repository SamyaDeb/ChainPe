import type { ReactNode } from 'react'
import type { Reputation as ReputationData, ReputationItem } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { AddressView, TxLink } from '@/components/ui/Address'
import { Pill } from '@/components/ui/Badges'
import { Card, PageHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/forms'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { formatScore } from '@/lib/money'
import { formatDateTime } from '@/lib/time'

const AVERAGE = /^\d+(\.\d+)?$/

function avg(v: string | null): string {
  return v !== null && AVERAGE.test(v) ? v : '\u2014'
}

const columns: Array<Column<ReputationItem>> = [
  { header: 'Score', cell: (r) => <span className="text-base font-semibold tabular-nums">{formatScore(r.value, r.valueDecimals) ?? '\u2014'}</span> },
  { header: 'Rated by', cell: (r) => <AddressView address={r.client} /> },
  {
    header: 'Paid you?',
    cell: (r) => (r.fromPayer ? <Pill tone="ok">Paid you</Pill> : <Pill tone="neutral">Never paid</Pill>),
  },
  { header: 'Tags', cell: (r) => [r.tag1, r.tag2].filter((t): t is string => !!t).join(', ') || <span className="text-muted">{'\u2014'}</span> },
  { header: 'Time', cell: (r) => formatDateTime(r.blockTs) },
  { header: 'Transaction', cell: (r) => <TxLink hash={r.txHash} label="Feedback transaction" /> },
]

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="div">
      <p className="font-semibold text-ink">{title}</p>
      <div className="mt-1 text-sm text-muted">{children}</div>
    </Card>
  )
}

function Ratings({ d }: { d: ReputationData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <Card>
          <p className="text-sm font-medium text-muted">From wallets that paid you</p>
          <p className="mt-1 text-5xl font-semibold tabular-nums text-ink">{avg(d.payerAverage)}</p>
          <p className="mt-1 text-sm text-muted">
            {d.payerCount} {d.payerCount === 1 ? 'rating' : 'ratings'} from paying wallets
          </p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-muted">All ratings, including wallets that never paid: anyone can rate an agent</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{avg(d.allAverage)}</p>
          <p className="mt-1 text-sm text-muted">
            {d.allCount} {d.allCount === 1 ? 'rating' : 'ratings'} in total
          </p>
        </Card>
      </div>
      {d.items === null ? (
        <LockedCard feature="Every review" description="Pro shows each rating with its score, tags, time, transaction and whether the rater paid you." />
      ) : d.items.length === 0 ? (
        <EmptyState title="No reviews yet" body="Reviews appear here once a wallet rates your agent." />
      ) : (
        <DataTable caption="Reviews" columns={columns} rows={d.items} rowKey={(r) => `${r.client}-${r.feedbackIndex}-${r.txHash}`} />
      )}
    </div>
  )
}

export function Reputation() {
  const { api } = useAuth()
  const rep = useResource('reputation', () => api.reputation())
  return (
    <>
      <PageHeader title="Reputation" subtitle="ERC-8004 ratings for your agent." />
      <ResourceView resource={rep}>
        {(d) => {
          switch (d.agentIdStatus) {
            case 'none':
              return <EmptyState title="No agent identity yet" body="Create one to start collecting ratings." command="chainpe identity" />
            case 'not_owner':
              return <Notice title="This wallet no longer owns the agent">Ratings are only shown to the current owner of the agent token.</Notice>
            case 'unknown':
              return (
                <Notice title="Ownership could not be checked">
                  <p>Arc could not confirm who owns your agent, so no ratings are shown. This is not the same as having no ratings.</p>
                  <Button className="mt-3" onClick={rep.reload}>
                    Retry
                  </Button>
                </Notice>
              )
            default:
              return <Ratings d={d} />
          }
        }}
      </ResourceView>
    </>
  )
}
