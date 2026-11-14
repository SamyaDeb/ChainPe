import type { ReactNode } from 'react'
import clsx from 'clsx'
import { ArrowRight, ExternalLink } from 'lucide-react'
import type { PublicService, PublicStats } from '@/api/schema'
import { Pill } from '@/components/ui/Badges'
import { Card, Tile, TileGrid } from '@/components/ui/Card'
import { CountInt, CountUsdc } from '@/components/ui/Motion'
import { addressUrl } from '@/lib/explorer'
import { formatPrice, formatUsdcExact } from '@/lib/money'
import { stars } from '@/lib/reputation'
import { Link } from '@/lib/router'

export const BYTES32 = /^0x[0-9a-fA-F]{64}$/

export function StatsRow({ s }: { s: PublicStats }) {
  return (
    <TileGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      <Tile label="USDC settled" value={<CountUsdc value={s.totalSettledAtomic} />} hint="Verified x402 payments, self-pay excluded" />
      <Tile label="Paid calls" value={<CountInt value={s.paidCalls} />} hint="Each one a USDC transfer on Avalanche" />
      <Tile label="Services" value={<CountInt value={s.services} />} hint="Active in the ChainPe registry" />
      <Tile label="Verified reviews" value={<CountInt value={s.verifiedReviews} />} hint={`Paid for. ${s.totalReviews.toLocaleString()} ratings in total`} />
    </TileGrid>
  )
}

export function ServiceBadges({ s }: { s: Pick<PublicService, 'agentId'> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pill tone="accent">x402</Pill>
      <Pill tone="accent">USDC</Pill>
      {s.agentId ? <Pill tone="accent">ERC-8004 #{s.agentId}</Pill> : <Pill tone="neutral">No ERC-8004 agent</Pill>}
    </div>
  )
}

/** The paid score is the headline. The raw score, which anyone can move by rating for free, sits faded under it. */
export function ScoreBlock({ s, size = 'card' }: { s: Pick<PublicService, 'paidScore' | 'paidReviews' | 'rawScore' | 'rawReviews'>; size?: 'card' | 'hero' }) {
  const big = size === 'hero' ? 'text-[clamp(4rem,12vw,8rem)] leading-[0.9]' : 'text-6xl leading-none'
  return (
    <div className="min-w-0">
      <p className="font-mono text-xs text-muted">Paid-only score</p>
      {s.paidScore === null ? (
        <p className={clsx('mt-2 font-display tracking-tight text-muted', size === 'hero' ? 'text-5xl' : 'text-3xl')}>No paid reviews yet</p>
      ) : (
        <p className={clsx('mt-2 font-display tracking-tight text-ink', big)}>
          {stars(s.paidScore)}
          <Star />
          <span className="sr-only"> out of 5</span>
        </p>
      )}
      <p className="mt-3 font-mono text-sm text-ink">
        {s.paidReviews} paid {s.paidReviews === 1 ? 'review' : 'reviews'}
      </p>
      <p className="mt-1 font-mono text-xs text-muted opacity-70" title="Every rating, including wallets that never paid. Not used for the score.">
        raw {stars(s.rawScore)}★ · {s.rawReviews}
      </p>
    </div>
  )
}

/** The star sits smaller and lighter than the number it follows, so the digits stay the headline. */
export function Star() {
  return (
    <span aria-hidden className="ml-1 align-[0.35em] text-[0.45em] text-muted">
      ★
    </span>
  )
}

const linkCls = 'inline-flex items-center gap-1 text-sm text-ink underline decoration-ink/30 underline-offset-4 transition-colors duration-300 hover:decoration-ink'

export function SnowtraceLink({ address, children }: { address: string; children: ReactNode }) {
  const url = addressUrl(address)
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={linkCls}>
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  )
}

export function ServiceCard({ s, actions }: { s: PublicService; actions?: ReactNode }) {
  return (
    <Card as="article" className="flex flex-col">
      <ServiceBadges s={s} />
      <h3 className="mt-5 break-words font-display text-4xl tracking-tight text-ink">{s.name}</h3>
      {s.description ? <p className="mt-2 text-muted">{s.description}</p> : null}

      <div className="mt-6 grid grid-cols-[1fr_auto] items-end gap-6">
        <ScoreBlock s={s} />
        <div className="text-right">
          <p className="font-display text-4xl leading-none tracking-tight text-ink">{formatPrice(s.price)}</p>
          <p className="mt-2 font-mono text-xs text-muted">per call</p>
        </div>
      </div>

      <p className="mt-6 font-mono text-xs text-muted">
        {formatUsdcExact(s.totalSettledAtomic)} settled · {s.paidCalls.toLocaleString()} paid {s.paidCalls === 1 ? 'call' : 'calls'}
      </p>
      {s.payToShared ? (
        <p className="mt-2 border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          An earlier service already uses this payTo, so its payments and ratings are credited there, not here.
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-6">
        {actions}
        <Link to={`/explore/${s.key}`} className={`group ${linkCls}`}>
          Reviews
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
        </Link>
        <SnowtraceLink address={s.payTo}>Verified onchain</SnowtraceLink>
      </div>
    </Card>
  )
}
