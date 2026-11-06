import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react'
import { isApiError } from '@/api/client'
import type { Resource } from '@/hooks/useResource'
import { Link } from '@/lib/router'
import { Card } from './Card'
import { CommandBlock } from './Copy'
import { Button } from './forms'

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const widths = ['w-full', 'w-5/6', 'w-2/3', 'w-3/4']
  return (
    <Card as="div">
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">Loading</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={`h-4 animate-pulse rounded bg-subtle ${widths[i % widths.length]}`} />
        ))}
      </div>
    </Card>
  )
}

export function errorMessage(error: unknown): { title: string; body: string } {
  if (isApiError(error)) {
    switch (error.code) {
      case 'chain_unavailable':
        return { title: 'Arc could not be read', body: 'The chain could not be reached right now. Your data is fine. Retry in a moment.' }
      case 'rate_limited':
        return { title: 'Too many requests', body: 'Slow down for a moment. This will retry on its own, or press Retry.' }
      case 'network_error':
        return { title: 'Could not reach ChainPe', body: 'Check your connection, then retry.' }
      default:
        return { title: 'Something went wrong', body: error.message }
    }
  }
  if (error instanceof Error) {
    // viem puts a one-line summary in shortMessage. Its full message is long and technical.
    const short = (error as { shortMessage?: unknown }).shortMessage
    return { title: 'Something went wrong', body: typeof short === 'string' ? short : error.message }
  }
  return { title: 'Something went wrong', body: 'Unknown error.' }
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, body } = errorMessage(error)
  return (
    <Card as="div" className="border-bad">
      <div role="alert" className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-bad" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-0.5 break-words text-sm text-muted">{body}</p>
          {onRetry ? (
            <Button className="mt-3" onClick={onRetry}>
              <RefreshCw size={16} aria-hidden /> Retry
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

export function EmptyState({ title, body, command }: { title: string; body?: string; command?: string }) {
  return (
    <Card as="div">
      <div className="flex flex-col items-start gap-2">
        <Inbox size={20} className="text-muted" aria-hidden />
        <p className="font-semibold text-ink">{title}</p>
        {body ? <p className="max-w-prose text-sm text-muted">{body}</p> : null}
        {command ? (
          <div className="w-full max-w-md">
            <CommandBlock command={command} />
          </div>
        ) : null}
      </div>
    </Card>
  )
}

const LOCK_BARS = [28, 44, 36, 62, 50, 74, 58, 84]

/** A Pro feature the plan does not include. The bars are decoration: no number is shown. */
export function LockedCard({ feature, description }: { feature: string; description?: string }) {
  return (
    <Card as="div" className="relative overflow-hidden">
      <svg viewBox="0 0 160 90" className="h-24 w-full select-none opacity-60 blur-sm" aria-hidden focusable="false" preserveAspectRatio="none">
        {LOCK_BARS.map((h, i) => (
          <rect key={i} x={i * 20 + 4} y={90 - h} width="12" height={h} rx="2" className="fill-accent" />
        ))}
      </svg>
      <div className="mt-3 flex flex-col items-start gap-1">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Lock size={16} aria-hidden /> {feature}
        </p>
        <p className="text-sm text-muted">{description ?? 'This is part of the Pro plan.'}</p>
        <Link
          to="/billing"
          className="mt-2 inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90 sm:min-h-10"
        >
          Upgrade with USDC
        </Link>
      </div>
    </Card>
  )
}

export function StaleNotice({ updatedAt, error, onRetry }: { updatedAt: number | null; error: unknown; onRetry: () => void }) {
  const when = updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'earlier'
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
      <span>Could not refresh ({errorMessage(error).title.toLowerCase()}). Showing data from {when}.</span>
      <button type="button" onClick={onRetry} className="min-h-9 rounded px-2 font-medium underline">
        Retry now
      </button>
    </div>
  )
}

interface ResourceViewProps<T> {
  resource: Resource<T>
  children: (data: T) => ReactNode
  isEmpty?: (data: T) => boolean
  empty?: ReactNode
  /** Shown instead of data when the API answers plan_required. */
  locked?: ReactNode
  skeletonRows?: number
}

/** Loading, error, locked, empty and data states for one resource. Data stays visible during refetches. */
export function ResourceView<T>({ resource, children, isEmpty, empty, locked, skeletonRows }: ResourceViewProps<T>) {
  const { data, error, loading, reload, updatedAt } = resource
  if (locked && isApiError(error) && error.code === 'plan_required') return <>{locked}</>
  if (data === null) {
    if (loading) return <Skeleton rows={skeletonRows} />
    return <ErrorState error={error} onRetry={reload} />
  }
  return (
    <>
      {error ? <StaleNotice updatedAt={updatedAt} error={error} onRetry={reload} /> : null}
      {isEmpty?.(data) && empty ? empty : children(data)}
    </>
  )
}
