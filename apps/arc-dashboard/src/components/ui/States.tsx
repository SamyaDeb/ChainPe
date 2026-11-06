import type { ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Lock, RefreshCw } from 'lucide-react'
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
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <span className="sr-only">Loading</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={`h-4 animate-pulse bg-ink/5 ${widths[i % widths.length]}`} />
        ))}
      </div>
    </Card>
  )
}

export function errorMessage(error: unknown): { title: string; body: string } {
  if (isApiError(error)) {
    switch (error.code) {
      case 'fees_due':
        return { title: 'Your data is locked', body: 'Unpaid ChainPe fees have reached the limit. Your API and paid calls keep working. Approve USDC in Billing to unlock this.' }
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
      <div role="alert" className="flex items-start gap-4">
        <AlertTriangle size={20} className="mt-2 shrink-0 text-bad" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl tracking-tight text-ink">{title}</p>
          <p className="mt-1 break-words text-sm text-muted">{body}</p>
          {isApiError(error) && error.code === 'fees_due' ? (
            <Link to="/billing" className="mt-4 inline-block text-sm font-medium text-ink underline underline-offset-4">
              Go to Billing
            </Link>
          ) : null}
          {onRetry ? (
            <Button className="mt-4" onClick={onRetry}>
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
      <div className="flex flex-col items-start gap-3">
        <p className="font-display text-4xl tracking-tight text-ink">{title}</p>
        {body ? <p className="max-w-prose text-muted">{body}</p> : null}
        {command ? (
          <div className="mt-2 w-full max-w-md">
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
    <div className="rise relative overflow-hidden border border-ink p-6 lg:p-10">
      <span aria-hidden className="absolute right-0 top-0 h-16 w-16 border-b border-l border-ink/10" />
      <span aria-hidden className="absolute bottom-0 left-0 h-16 w-16 border-r border-t border-ink/10" />
      <div className="relative grid items-center gap-8 md:grid-cols-[3fr_2fr]">
        <div className="flex flex-col items-start gap-3">
          <p className="flex items-center gap-2 font-mono text-sm text-muted">
            <Lock size={14} aria-hidden /> Part of Pro
          </p>
          <p className="font-display text-4xl leading-[0.95] tracking-tight text-ink lg:text-5xl">{feature}</p>
          <p className="max-w-prose text-muted">{description ?? 'This is part of the Pro plan.'}</p>
          <Link
            to="/billing"
            className="group mt-3 inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-medium text-accent-fg transition-colors duration-300 hover:bg-accent/90"
          >
            Upgrade with USDC
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
          </Link>
        </div>
        <svg viewBox="0 0 160 90" className="h-28 w-full select-none opacity-30 blur-sm" aria-hidden focusable="false" preserveAspectRatio="none">
          {LOCK_BARS.map((h, i) => (
            <rect key={i} x={i * 20 + 4} y={90 - h} width="12" height={h} className="fill-ink" />
          ))}
        </svg>
      </div>
    </div>
  )
}

export function StaleNotice({ updatedAt, error, onRetry }: { updatedAt: number | null; error: unknown; onRetry: () => void }) {
  const when = updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'earlier'
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-warn bg-warn-soft px-4 py-2 text-sm text-warn">
      <span>Could not refresh ({errorMessage(error).title.toLowerCase()}). Showing data from {when}.</span>
      <button type="button" onClick={onRetry} className="min-h-9 px-2 font-medium underline underline-offset-4">
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
