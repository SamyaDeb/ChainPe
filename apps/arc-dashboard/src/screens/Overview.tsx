import { useState } from 'react'
import type { Range, Summary } from '@/api/schema'
import { useMe } from '@/auth/useMe'
import { useAuth } from '@/auth/AuthContext'
import { BarChart } from '@/components/BarChart'
import { LiveStatus } from '@/components/LiveStatus'
import { NotCounted } from '@/components/NotCounted'
import { RangePicker } from '@/components/RangePicker'
import { Card, PageHeader, SectionTitle, Tile } from '@/components/ui/Card'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useNow } from '@/hooks/useNow'
import { useResource } from '@/hooks/useResource'
import { formatRate, formatUsdc, formatUsdcExact, parseAtomic, permille } from '@/lib/money'
import { fillSeries } from '@/lib/series'

const POLL_MS = 3000

function RailSplit({ summary }: { summary: Summary }) {
  const exact = parseAtomic(summary.revenue.exactAtomic) ?? 0n
  const gateway = parseAtomic(summary.revenue.gateway.settledAtomic) ?? 0n
  const total = exact + gateway
  const exactShare = permille(exact, total)
  return (
    <Card>
      <SectionTitle>Rail split (verified, settled)</SectionTitle>
      {total === 0n ? (
        <p className="text-sm text-muted">No verified revenue in this range yet.</p>
      ) : (
        <>
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-3 w-full overflow-hidden rounded" role="img" aria-label={`Exact ${exactShare / 10} percent, Gateway ${(1000 - exactShare) / 10} percent`}>
            <rect width="100" height="4" className="fill-edge" />
            <rect width={exactShare / 10} height="4" className="fill-accent" />
          </svg>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="flex items-center gap-2 text-muted">
                <span aria-hidden className="h-2 w-2 rounded-sm bg-accent" /> Exact
              </dt>
              <dd className="font-semibold tabular-nums">{formatUsdc(exact)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-muted">
                <span aria-hidden className="h-2 w-2 rounded-sm bg-edge" /> Gateway settled
              </dt>
              <dd className="font-semibold tabular-nums">{formatUsdc(gateway)}</dd>
            </div>
          </dl>
        </>
      )}
    </Card>
  )
}

function GatewayBalances() {
  const { api } = useAuth()
  const services = useResource('overview-services', () => api.services(), { pollMs: 15_000 })
  return (
    <Card>
      <SectionTitle>Gateway balance</SectionTitle>
      <ResourceView resource={services} skeletonRows={2}>
        {(data) => {
          const rows = data.services.filter((s) => s.gatewayBalanceAtomic !== null)
          if (rows.length === 0) {
            return <p className="text-sm text-muted">No Gateway balance reported yet. Your proxy sends it with each heartbeat: run <code className="font-mono">chainpe start</code>.</p>
          }
          return (
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((s) => (
                <li key={s.key} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span className="min-w-0 break-words">{s.name}</span>
                  <span className="font-semibold tabular-nums">{formatUsdcExact(s.gatewayBalanceAtomic)}</span>
                </li>
              ))}
            </ul>
          )
        }}
      </ResourceView>
    </Card>
  )
}

export function Overview() {
  const me = useMe()
  const { api } = useAuth()
  const [range, setRange] = useState<Range>('7d')
  const now = useNow(60_000)
  const summary = useResource(`summary-${range}`, () => api.summary(range), { pollMs: POLL_MS })

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Revenue counts verified payments only."
        right={summary.error === null || summary.data !== null ? <LiveStatus updatedAt={summary.updatedAt} failing={summary.error !== null} /> : null}
      />
      <div className="mb-4">
        <RangePicker value={range} plan={me.plan} onChange={setRange} />
      </div>
      <div className="flex flex-col gap-4">
        <ResourceView
          resource={summary}
          locked={<LockedCard feature="Longer time ranges" description="30 days, 90 days and all time are part of the Pro plan." />}
          skeletonRows={5}
        >
          {(s) => (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Verified revenue" value={formatUsdc(s.revenue.totalVerifiedAtomic)} hint="Verified payments, self-pay excluded" />
                <Tile label="Exact rail" value={formatUsdc(s.revenue.exactAtomic)} hint="Verified against a USDC transfer on Arc" />
                <Tile label="Gateway settled" value={formatUsdc(s.revenue.gateway.settledAtomic)} hint="Verified against Circle's record" />
                <Tile
                  label="Gateway pending"
                  value={formatUsdc(s.revenue.gateway.pendingBatchAtomic)}
                  hint="Accepted by Circle, batch not landed, can still fail"
                  tone="warn"
                />
                <Tile label="Paid calls" value={s.calls.completed} hint={`${s.calls.verified} verified`} />
                <Tile label="Success rate" value={formatRate(s.calls.successRate)} hint="Completed of completed plus failed" />
                <Tile label="Unique buyers" value={s.uniqueBuyers} hint="Wallets that paid you" />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <RailSplit summary={s} />
                <GatewayBalances />
              </div>

              <Card>
                <SectionTitle>Verified revenue per {s.series.unit}</SectionTitle>
                {s.series.points.length === 0 ? (
                  <EmptyState title="No calls in this range" body="Start your proxy to see paid calls arrive here." command="chainpe start" />
                ) : (
                  <BarChart bars={fillSeries(s.series.points, s.series.unit, s.since, s.range, now)} unit={s.series.unit} />
                )}
              </Card>

              <NotCounted notRevenue={s.notRevenue} />
            </>
          )}
        </ResourceView>
      </div>
    </>
  )
}
