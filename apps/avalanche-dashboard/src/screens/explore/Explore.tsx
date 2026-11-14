import type { ReactNode } from 'react'
import { publicApi } from '@/api/client'
import type { PublicService, PublicSettlement } from '@/api/schema'
import { LiveStatus } from '@/components/LiveStatus'
import { AddressView, TxLink } from '@/components/ui/Address'
import { Note, PageHeader, SectionTitle } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { EmptyState, ResourceView } from '@/components/ui/States'
import { useNow } from '@/hooks/useNow'
import { usePublicResource } from '@/hooks/useResource'
import { formatUsdcExact } from '@/lib/money'
import { ago, formatDateTime } from '@/lib/time'
import { ServiceCard, StatsRow } from './parts'

const FEED_POLL_MS = 5_000
const STATS_POLL_MS = 15_000
const FEED_LIMIT = 12

function feedColumns(now: number): Array<Column<PublicSettlement>> {
  return [
    {
      header: 'When',
      cell: (p) => (
        <time dateTime={p.ts} title={formatDateTime(p.ts)} className="whitespace-nowrap">
          {ago(p.ts, now)}
        </time>
      ),
    },
    { header: 'Service', cell: (p) => <span className="font-medium">{p.service}</span> },
    { header: 'Amount', cell: (p) => <span className="font-mono tabular-nums">{formatUsdcExact(p.amountAtomic)}</span> },
    { header: 'Payer', cell: (p) => <AddressView address={p.payer} copy={false} /> },
    { header: 'Settlement', cell: (p) => <TxLink hash={p.txHash} label="Settlement transaction" /> },
  ]
}

function LiveFeed() {
  const feed = usePublicResource('public-feed', () => publicApi.publicFeed(FEED_LIMIT), { pollMs: FEED_POLL_MS })
  const now = useNow(1000)
  return (
    <section aria-labelledby="feed-title">
      <SectionTitle right={feed.data !== null || feed.error === null ? <LiveStatus updatedAt={feed.updatedAt} failing={feed.error !== null} /> : null}>
        <span id="feed-title">Live payments</span>
      </SectionTitle>
      <ResourceView
        resource={feed}
        skeletonRows={5}
        isEmpty={(d) => d.settlements.length === 0}
        empty={<EmptyState title="No settlements yet" body="Verified x402 payments on Avalanche show up here within seconds of settling." />}
      >
        {(d) => <DataTable caption="Latest verified settlements" columns={feedColumns(now)} rows={d.settlements} rowKey={(p) => `${p.txHash}-${p.serviceKey}`} />}
      </ResourceView>
    </section>
  )
}

export function Explore({ cardActions }: { cardActions?: (s: PublicService) => ReactNode }) {
  const stats = usePublicResource('public-stats', () => publicApi.publicStats(), { pollMs: STATS_POLL_MS })
  const services = usePublicResource('public-services', () => publicApi.publicServices(), { pollMs: STATS_POLL_MS })

  return (
    <>
      <PageHeader title="Explore" subtitle="Live x402 payments on Avalanche mainnet" />
      <p className="-mt-6 mb-10 max-w-2xl text-xl leading-relaxed text-muted lg:-mt-10 lg:mb-16">
        Reputation you can&apos;t fake. Only agents that actually paid for a service can move its score. Every number here is read from Avalanche, and nobody has to sign in to see it.
      </p>

      <div className="flex flex-col gap-12 lg:gap-16">
        <ResourceView resource={stats} skeletonRows={2}>
          {(s) => <StatsRow s={s} />}
        </ResourceView>

        <section aria-labelledby="services-title">
          <SectionTitle>
            <span id="services-title">Services</span>
          </SectionTitle>
          <div className="mb-6">
            <Note>The big score counts only ratings backed by an x402 payment from the rater to that service. The faded raw score counts every rating, paid or not.</Note>
          </div>
          <ResourceView
            resource={services}
            skeletonRows={4}
            isEmpty={(d) => d.services.length === 0}
            empty={<EmptyState title="No services yet" body="Services appear here once they are registered in the ChainPe registry on Avalanche." command="npx @chainpeavax/cli register" />}
          >
            {(d) => (
              <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {d.services.map((s) => (
                  <li key={s.key} className="flex min-w-0">
                    <div className="flex w-full min-w-0 [&>article]:w-full">
                      <ServiceCard s={s} actions={cardActions?.(s)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ResourceView>
        </section>

        <LiveFeed />
      </div>
    </>
  )
}
