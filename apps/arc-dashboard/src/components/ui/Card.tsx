import type { ReactNode } from 'react'
import clsx from 'clsx'

export function Card({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'li' }) {
  return <Tag className={clsx('min-w-0 rounded-lg border border-line bg-surface p-4', className)}>{children}</Tag>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">{children}</h2>
      {right}
    </div>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-prose text-sm text-muted">{subtitle}</p> : null}
      </div>
      {right}
    </header>
  )
}

export function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' }) {
  return (
    <div className={clsx('min-w-0 rounded-lg border p-4', tone === 'warn' ? 'border-warn bg-warn-soft' : 'border-line bg-surface')}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-subtle px-3 py-2 text-xs text-muted">{children}</p>
}
