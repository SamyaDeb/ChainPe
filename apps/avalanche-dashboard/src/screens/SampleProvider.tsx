/**
 * /sample: a read-only Overview of one demo provider, for visitors without a wallet. Reads only
 * GET /v1/public/providers/:address/summary, which the backend serves for its SAMPLE_PROVIDERS allowlist alone and
 * which carries aggregates only (no buyers, keys or wallets).
 */
import { useState } from 'react'
import { Eye } from 'lucide-react'
import { publicApi } from '@/api/client'
import type { Range } from '@/api/schema'
import { AnimatedSphere } from '@/components/AnimatedSphere'
import { BarChart } from '@/components/BarChart'
import { LiveStatus } from '@/components/LiveStatus'
import { RangePicker } from '@/components/RangePicker'
import { AddressView } from '@/components/ui/Address'
import { Card, Eyebrow, SectionTitle, Tile, TileGrid } from '@/components/ui/Card'
import { CountInt, CountUsdc } from '@/components/ui/Motion'
import { EmptyState, ResourceView } from '@/components/ui/States'
import { useNow } from '@/hooks/useNow'
import { usePublicResource } from '@/hooks/useResource'
import { SAMPLE_PROVIDER } from '@/lib/env'
import { formatRate } from '@/lib/money'
import { Link } from '@/lib/router'
import { fillSeries } from '@/lib/series'
import { ScoreBlock, ServiceCard } from './explore/parts'
import { TryItButton } from './explore/TryIt'

const POLL_MS = 15_000

const RANGE_TEXT: Record<Range, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  all: 'all time',
}

function ReadOnlyBanner({ address }: { address: string }) {
  return (
    <div role="note" className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border border-ink bg-subtle px-4 py-3 lg:mb-12">
      <p className="flex items-center gap-2 font-mono text-sm text-ink">
        <Eye size={16} aria-hidden />
        Sample provider · read-only
      </p>
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
        A real provider on Avalanche mainnet, shown to everyone. Buyers and keys stay private.
        <AddressView address={address} copy={false} />
      </p>
    </div>
  )
}

function Summary({ address }: { address: string }) {
  const [range, setRange] = useState<Range>('7d')
  const now = useNow(60_000)
  const summary = usePublicResource(`sample-${address}-${range}`, () => publicApi.providerSummary(address, range), { pollMs: POLL_MS })
  const s = summary.data

  return (
    <>
      <h1 className="sr-only">Sample provider</h1>
      <ReadOnlyBanner address={address} />
      <section className="bleed relative overflow-hidden">
        <div aria-hidden className="grid-lines pointer-events-none absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute -right-40 top-1/2 h-[520px] w-[520px] -translate-y-1/2 opacity-30 lg:right-0 lg:h-[680px] lg:w-[680px]">
          <AnimatedSphere />
        </div>
        <div className="relative mx-auto max-w-[1400px] px-6 py-12 lg:px-12 lg:py-16">
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
              <p className="mt-1 max-w-xl text-muted">Each payment is a USDC transfer on Avalanche. Self-pay excluded.</p>
            </div>
          ) : null}
          <div className="mt-10">
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>
      </section>

      <div className="mt-10 flex flex-col gap-6 lg:mt-16">
        <ResourceView resource={summary} skeletonRows={5}>
          {(d) => (
            <>
              <TileGrid className="grid-cols-1 sm:grid-cols-3">
                <Tile label="Paid calls" value={<CountInt value={d.calls.completed} />} hint={`${d.calls.verified} verified`} />
                <Tile label="Success rate" value={formatRate(d.calls.successRate)} hint="Completed of completed plus failed" />
                <Tile label="Unique buyers" value={<CountInt value={d.uniqueBuyers} />} hint="A count only. Buyers are never listed here." />
              </TileGrid>

              <Card>
                <SectionTitle>Verified revenue per {d.series.unit}</SectionTitle>
                {d.series.points.length === 0 ? (
                  <EmptyState title="No payments in this range" body="Pick a longer range, or try one of the services below." />
                ) : (
                  <BarChart bars={fillSeries(d.series.points, d.series.unit, d.since, d.range, now)} unit={d.series.unit} />
                )}
              </Card>

              <Card>
                <SectionTitle>Reputation</SectionTitle>
                <ScoreBlock s={d.reputation} size="hero" />
                <p className="mt-6 max-w-prose text-sm text-muted">
                  Across all of this provider&apos;s services. Only ratings backed by an x402 payment from the rater count; the faded raw score includes every rating.
                </p>
              </Card>

              <section aria-labelledby="sample-services" className="mt-6">
                <SectionTitle>
                  <span id="sample-services">Services</span>
                </SectionTitle>
                {d.services.length === 0 ? (
                  <EmptyState title="No active services" body="This provider has no service listed in the registry right now." />
                ) : (
                  <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {d.services.map((svc) => (
                      <li key={svc.key} className="flex min-w-0">
                        <div className="flex w-full min-w-0 [&>article]:w-full">
                          <ServiceCard s={svc} actions={<TryItButton s={svc} />} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </ResourceView>
      </div>
    </>
  )
}

export function SampleProvider() {
  if (!SAMPLE_PROVIDER) {
    return (
      <EmptyState title="No sample provider" body="This build has no sample provider configured. Explore shows every service and live payment instead." />
    )
  }
  return (
    <>
      <Summary key={SAMPLE_PROVIDER} address={SAMPLE_PROVIDER} />
      <p className="mt-12 text-sm text-muted">
        Have a service of your own?{' '}
        <Link to="/" className="text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
          Sign in with its wallet
        </Link>{' '}
        to see your buyers, payments and ratings.
      </p>
    </>
  )
}
