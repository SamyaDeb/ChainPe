import { useState } from 'react'
import type { Range, Summary } from '@/api/schema'
import { useMe } from '@/auth/useMe'
import { useAuth } from '@/auth/AuthContext'
import { AnimatedSphere } from '@/components/AnimatedSphere'
import { BarChart } from '@/components/BarChart'
import { LiveStatus } from '@/components/LiveStatus'
import { NotCounted } from '@/components/NotCounted'
import { RangePicker } from '@/components/RangePicker'
import { Card, Eyebrow, SectionTitle, Tile, TileGrid } from '@/components/ui/Card'
import { CountInt, CountUsdc } from '@/components/ui/Motion'
import { EmptyState, LockedCard, ResourceView } from '@/components/ui/States'
import { useNow } from '@/hooks/useNow'
import { useResource } from '@/hooks/useResource'
import { isAddressLike, shortHex } from '@/lib/explorer'
import { formatRate, formatUsdc, parseAtomic, permille } from '@/lib/money'
import { fillSeries } from '@/lib/series'

const POLL_MS = 3000
const TICKER_POLL_MS = 15_000
const TICKER_MIN_ITEMS = 10

const RANGE_TEXT: Record<Range, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  all: 'all time',
}

function RailSplit({ summary }: { summary: Summary }) {
  const exact = parseAtomic(summary.revenue.exactAtomic) ?? 0n
  const gateway = parseAtomic(summary.revenue.gateway.settledAtomic) ?? 0n
  const total = exact + gateway
  const exactShare = permille(exact, total)
  return (
    <Card>
      <SectionTitle>Rail split</SectionTitle>
      <p className="mb-4 font-mono text-xs text-muted">Verified and settled</p>
      {total === 0n ? (
        <p className="text-sm text-muted">No verified revenue in this range yet.</p>
      ) : (
        <>
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="line-reveal h-3 w-full" role="img" aria-label={`Exact ${exactShare / 10} percent, Gateway ${(1000 - exactShare) / 10} percent`}>
            <rect width="100" height="4" className="fill-ink/20" />
            <rect width={exactShare / 10} height="4" className="fill-ink" />
          </svg>
          <dl className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <dt className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className="h-2 w-2 bg-ink" /> Exact
              </dt>
              <dd className="mt-1 font-display text-3xl tracking-tight">{formatUsdc(exact)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-2 text-sm text-muted">
                <span aria-hidden className="h-2 w-2 bg-ink/20" /> Gateway settled
              </dt>
              <dd className="mt-1 font-display text-3xl tracking-tight">{formatUsdc(gateway)}</dd>
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
            <ul className="flex flex-col divide-y divide-ink/10">
              {rows.map((s) => (
                <li key={s.key} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="min-w-0 break-words text-sm">{s.name}</span>
                  <span className="font-display text-3xl tracking-tight">{formatUsdc(s.gatewayBalanceAtomic)}</span>
                </li>
              ))}
            </ul>
          )
        }}
      </ResourceView>
    </Card>
  )
}

/**
 * Recent verified payments as a moving strip, like the landing page's stats. It repeats what the
 * Payments screen lists, so it is hidden from screen readers. Self-pay never appears in it.
 */
function PaymentTicker() {
  const { api } = useAuth()
  const recent = useResource('overview-ticker', () => api.payments({ limit: 12, verification: 'verified' }), { pollMs: TICKER_POLL_MS })
  const rows = (recent.data?.payments ?? []).filter((p) => p.verification === 'verified' && !p.selfPay)
  if (rows.length === 0) return null
  // Each half must be wider than the screen for the loop to be seamless.
  const half = Array.from({ length: Math.ceil(TICKER_MIN_ITEMS / rows.length) }, () => rows).flat()
  return (
    <div aria-hidden className="fade-in bleed overflow-hidden border-y border-ink/10 bg-bg py-6">
      <div className="marquee flex w-max">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0 gap-16 pr-16">
            {half.map((p, i) => (
              <li key={`${p.id}-${i}`} className="flex items-baseline gap-4 whitespace-nowrap">
                <span className="font-display text-4xl tracking-tight lg:text-5xl">{formatUsdc(p.amountAtomic)}</span>
                <span className="text-sm text-muted">
                  {p.method} {p.route}
                  <span className="mt-1 block font-mono text-xs">
                    {p.rail === 'exact' ? 'Exact' : 'Gateway'}
                    {isAddressLike(p.payer) ? `, ${shortHex(p.payer)}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  )
}

export function Overview() {
  const me = useMe()
  const { api } = useAuth()
  const [range, setRange] = useState<Range>('7d')
  const now = useNow(60_000)
  const summary = useResource(`summary-${range}`, () => api.summary(range), { pollMs: POLL_MS })
  const s = summary.data
  const pending = s ? (parseAtomic(s.revenue.gateway.pendingBatchAtomic) ?? 0n) : 0n

  return (
    <>
      <h1 className="sr-only">Overview</h1>
      <section className="bleed relative -mt-10 overflow-hidden lg:-mt-16">
        <div aria-hidden className="grid-lines pointer-events-none absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute -right-40 top-1/2 h-[520px] w-[520px] -translate-y-1/2 opacity-30 lg:right-0 lg:h-[680px] lg:w-[680px]">
          <AnimatedSphere />
        </div>
        <div className="relative mx-auto max-w-[1400px] px-6 py-12 lg:px-12 lg:py-20">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <Eyebrow>Revenue counts verified payments only</Eyebrow>
            {summary.error === null || s !== null ? <LiveStatus updatedAt={summary.updatedAt} failing={summary.error !== null} /> : null}
          </div>
          {s ? (
            <div className="rise">
              <p className="break-words font-display text-[clamp(4rem,15vw,12rem)] leading-[0.9] tracking-tight text-ink">
                <CountUsdc value={s.revenue.totalVerifiedAtomic} />
              </p>
              <p className="mt-6 text-xl text-ink lg:text-2xl">Verified revenue, {RANGE_TEXT[s.range] ?? RANGE_TEXT[range]}</p>
              <p className="mt-1 max-w-xl text-muted">
                {pending > 0n ? `Includes ${formatUsdc(pending)} Gateway pending, which can still fail` : 'Verified payments, self-pay excluded'}
              </p>
            </div>
          ) : null}
          <div className="mt-10">
            <RangePicker value={range} plan={me.plan} onChange={setRange} />
          </div>
        </div>
      </section>

      <PaymentTicker />

      <div className="mt-10 flex flex-col gap-6 lg:mt-16">
        <ResourceView
          resource={summary}
          locked={<LockedCard feature="Longer time ranges" description="30 days, 90 days and all time are part of the Pro plan." />}
          skeletonRows={5}
        >
          {(d) => (
            <>
              <TileGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                <Tile label="Exact rail" value={<CountUsdc value={d.revenue.exactAtomic} />} hint="Verified against a USDC transfer on Arc" />
                <Tile label="Gateway settled" value={<CountUsdc value={d.revenue.gateway.settledAtomic} />} hint="Verified against Circle's record" />
                <Tile
                  label="Gateway pending"
                  value={<CountUsdc value={d.revenue.gateway.pendingBatchAtomic} />}
                  hint="Accepted by Circle, batch not landed, can still fail"
                  tone="warn"
                />
                <Tile label="Paid calls" value={<CountInt value={d.calls.completed} />} hint={`${d.calls.verified} verified`} />
                <Tile label="Success rate" value={formatRate(d.calls.successRate)} hint="Completed of completed plus failed" />
                <Tile label="Unique buyers" value={<CountInt value={d.uniqueBuyers} />} hint="Wallets that paid you" />
              </TileGrid>

              <Card>
                <SectionTitle>Verified revenue per {d.series.unit}, including Gateway pending</SectionTitle>
                {d.series.points.length === 0 ? (
                  <EmptyState title="No calls in this range" body="Start your proxy to see paid calls arrive here." command="chainpe start" />
                ) : (
                  <BarChart bars={fillSeries(d.series.points, d.series.unit, d.since, d.range, now)} unit={d.series.unit} />
                )}
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                <RailSplit summary={d} />
                <GatewayBalances />
              </div>

              <NotCounted notRevenue={d.notRevenue} />
            </>
          )}
        </ResourceView>
      </div>
    </>
  )
}
