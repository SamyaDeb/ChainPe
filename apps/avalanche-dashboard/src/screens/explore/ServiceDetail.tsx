import { useState, type ReactNode } from 'react'
import { ArrowLeft, CheckCircle2, CircleDashed, XCircle } from 'lucide-react'
import { publicApi } from '@/api/client'
import type { PublicReview, PublicService } from '@/api/schema'
import { AddressView, TxLink } from '@/components/ui/Address'
import { Pill } from '@/components/ui/Badges'
import { Card, PageHeader, SectionTitle } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/forms'
import { EmptyState, ResourceView } from '@/components/ui/States'
import { usePublicResource } from '@/hooks/useResource'
import { formatPrice, formatUsdcExact } from '@/lib/money'
import { reviewReason, stars } from '@/lib/reputation'
import { Link } from '@/lib/router'
import { formatDateTime } from '@/lib/time'
import { BYTES32, ScoreBlock, ServiceBadges, SnowtraceLink, Star } from './parts'

const PAGE = 50
const REVIEWS_POLL_MS = 10_000

function StatusBadge({ r }: { r: PublicReview }) {
  if (r.status === 'verified') {
    return (
      <Pill tone="ok">
        <CheckCircle2 size={12} aria-hidden /> Verified
      </Pill>
    )
  }
  if (r.status === 'pending') {
    return (
      <Pill tone="warn">
        <CircleDashed size={12} aria-hidden /> Checking
      </Pill>
    )
  }
  return (
    <Pill tone="bad">
      <XCircle size={12} aria-hidden /> Unverified
    </Pill>
  )
}

const columns: Array<Column<PublicReview>> = [
  {
    header: 'Score',
    cell: (r) => (
      <span className={`font-display text-3xl tracking-tight ${r.status === 'verified' ? 'text-ink' : 'text-muted'}`}>
        {stars(r.score)}
        <Star />
      </span>
    ),
  },
  {
    header: 'Status',
    cell: (r) => (
      <div className="flex flex-col items-end gap-1 sm:items-start">
        <div className="flex flex-wrap justify-end gap-1 sm:justify-start">
          <StatusBadge r={r} />
          {r.revoked ? <Pill tone="neutral">Revoked</Pill> : null}
        </div>
        <p className="max-w-xs text-xs text-muted">{reviewReason(r)}</p>
      </div>
    ),
  },
  { header: 'Rated by', cell: (r) => <AddressView address={r.client} copy={false} /> },
  {
    header: 'Payment',
    cell: (r) =>
      r.status === 'verified' && r.paymentTx ? (
        <div className="flex flex-col items-end gap-1 sm:items-start">
          <TxLink hash={r.paymentTx} label="Payment transaction" />
          {r.paidAtomic ? <span className="font-mono text-xs text-muted">{formatUsdcExact(r.paidAtomic)} paid</span> : null}
        </div>
      ) : (
        <span className="text-muted">{'—'}</span>
      ),
  },
  { header: 'Time', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.blockTs)}</span> },
  { header: 'Rating tx', cell: (r) => <TxLink hash={r.txHash} label="Rating transaction" /> },
]

function Reviews({ serviceKey }: { serviceKey: string }) {
  const [offset, setOffset] = useState(0)
  const reviews = usePublicResource(`public-reviews-${serviceKey}-${offset}`, () => publicApi.publicReviews(serviceKey, { limit: PAGE, offset }), { pollMs: REVIEWS_POLL_MS })
  return (
    <section aria-labelledby="reviews-title">
      <SectionTitle>
        <span id="reviews-title">Reviews</span>
      </SectionTitle>
      <ResourceView
        resource={reviews}
        isEmpty={(d) => d.reviews.length === 0 && d.offset === 0}
        empty={<EmptyState title="No reviews yet" body="Pay for a call, then rate it. A rating with the payment attached shows here as verified." />}
      >
        {(d) => (
          <>
            <DataTable caption="Reviews" columns={columns} rows={d.reviews} rowKey={(r) => `${r.client}-${r.feedbackIndex}-${r.txHash}`} />
            {d.total > PAGE ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-xs text-muted">
                  {d.offset + 1}–{Math.min(d.offset + d.reviews.length, d.total)} of {d.total}
                </p>
                <div className="flex gap-2">
                  <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Newer
                  </Button>
                  <Button disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>
                    Older
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </ResourceView>
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-all text-sm text-ink">{children}</dd>
    </div>
  )
}

function Header({ s, actions }: { s: PublicService; actions?: ReactNode }) {
  return (
    <>
      <PageHeader title={s.name} subtitle="Service on ChainPe" right={<ServiceBadges s={s} />} />
      <div className="mb-12 grid gap-6 md:grid-cols-[3fr_2fr]">
        <Card>
          <ScoreBlock s={s} size="hero" />
          <p className="mt-6 max-w-prose text-sm text-muted">
            Weighted by USDC paid, capped per rating so one big payment cannot dominate. Ratings with no matching payment are listed below but never counted.
          </p>
        </Card>
        <Card className="flex flex-col">
          <p className="font-display text-6xl leading-none tracking-tight text-ink">{formatPrice(s.price)}</p>
          <p className="mt-2 font-mono text-xs text-muted">per call</p>
          <dl className="mt-6 grid gap-4">
            <Fact label="Endpoint">{s.endpoint}</Fact>
            <Fact label="Pays to">
              <AddressView address={s.payTo} />
            </Fact>
            <Fact label="Settled">
              {formatUsdcExact(s.totalSettledAtomic)} · {s.paidCalls.toLocaleString()} paid calls
            </Fact>
          </dl>
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-6">
            {actions}
            <SnowtraceLink address={s.payTo}>Verified onchain</SnowtraceLink>
          </div>
        </Card>
      </div>
    </>
  )
}

export function ServiceDetail({ serviceKey, actions }: { serviceKey: string; actions?: (s: PublicService) => ReactNode }) {
  const valid = BYTES32.test(serviceKey)
  const key = serviceKey.toLowerCase()
  const services = usePublicResource('public-services', () => publicApi.publicServices(), { enabled: valid })

  return (
    <>
      <Link to="/explore" className="group mb-8 inline-flex items-center gap-2 text-sm text-muted transition-colors duration-300 hover:text-ink">
        <ArrowLeft size={14} className="transition-transform duration-300 group-hover:-translate-x-1" aria-hidden />
        All services
      </Link>
      {!valid ? (
        <EmptyState title="No such service" body="That link does not name a ChainPe service." />
      ) : (
        <ResourceView resource={services} skeletonRows={4}>
          {(d) => {
            const s = d.services.find((x) => x.key.toLowerCase() === key)
            if (!s) return <EmptyState title="No such service" body="It may have been deregistered, or the link is wrong." />
            return (
              <>
                <Header s={s} actions={actions?.(s)} />
                <Reviews serviceKey={key} />
              </>
            )
          }}
        </ResourceView>
      )}
    </>
  )
}
