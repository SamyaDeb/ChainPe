import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { isApiError } from '@/api/client'
import type { Resource } from '@/hooks/useResource'
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
      case 'chain_unavailable':
        return { title: 'Avalanche could not be read', body: 'The chain could not be reached right now. Your data is fine. Retry in a moment.' }
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
  skeletonRows?: number
}

/** Loading, error, empty and data states for one resource. Data stays visible during refetches. */
export function ResourceView<T>({ resource, children, isEmpty, empty, skeletonRows }: ResourceViewProps<T>) {
  const { data, error, loading, reload, updatedAt } = resource
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
