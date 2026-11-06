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
  { header: 'Score', cell: (r) => <span className="font-display text-3xl tracking-tight">{formatScore(r.value, r.valueDecimals) ?? '\u2014'}</span> },
  { header: 'Rated by', cell: (r) => <AddressView address={r.client} /> },
  {
    header: 'Paid you?',
    cell: (r) => (r.fromPayer ? <Pill tone="ok">Paid you</Pill> : <Pill tone="neutral">No verified payment</Pill>),
  },
  { header: 'Tags', cell: (r) => [r.tag1, r.tag2].filter((t): t is string => !!t).join(', ') || <span className="text-muted">{'\u2014'}</span> },
  { header: 'Time', cell: (r) => formatDateTime(r.blockTs) },
  { header: 'Transaction', cell: (r) => <TxLink hash={r.txHash} label="Feedback transaction" /> },
]

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="div">
      <p className="font-display text-4xl tracking-tight text-ink">{title}</p>
      <div className="mt-3 text-muted">{children}</div>
    </Card>
  )
}

function Ratings({ d }: { d: ReputationData }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <Card>
          <p className="text-muted">From wallets that paid you</p>
          <p className="mt-4 font-display text-[clamp(5rem,14vw,10rem)] leading-[0.9] tracking-tight text-ink">{avg(d.payerAverage)}</p>
          <p className="mt-4 font-mono text-sm text-muted">
            {d.payerCount} {d.payerCount === 1 ? 'rating' : 'ratings'} from paying wallets
          </p>
        </Card>
        <Card>
          <p className="text-muted">All ratings, including wallets with no verified payment: anyone can rate an agent</p>
          <p className="mt-4 font-display text-6xl leading-none tracking-tight text-ink lg:text-7xl">{avg(d.allAverage)}</p>
          <p className="mt-4 font-mono text-sm text-muted">
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
