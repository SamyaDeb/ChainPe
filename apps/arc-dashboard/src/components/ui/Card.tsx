import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CharIn } from './Motion'

export function Card({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' | 'li' }) {
  return <Tag className={clsx('rise min-w-0 border border-ink/10 bg-surface p-6 lg:p-8', className)}>{children}</Tag>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-3xl tracking-tight text-ink lg:text-4xl">{children}</h2>
      {right}
    </div>
  )
}

/** The landing's small mono label with its short lead-in rule. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-mono text-sm text-muted">
      <span aria-hidden className="h-px w-8 shrink-0 bg-ink/30" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-10 lg:mb-16">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {subtitle ? <Eyebrow>{subtitle}</Eyebrow> : <span />}
        {right}
      </div>
      <h1 className="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.95] tracking-tight text-ink">
        <span className="sr-only">{title}</span>
        <CharIn text={title} />
      </h1>
    </header>
  )
}

/** Tiles divided by hairlines, as in the landing's metrics grid. */
export function TileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rise grid gap-px border border-ink/10 bg-ink/10', className)}>{children}</div>
}

export function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' }) {
  return (
    <div className={clsx('min-w-0 p-6 lg:p-8', tone === 'warn' ? 'bg-warn-soft' : 'bg-bg')}>
      <p className="break-words font-display text-5xl leading-none tracking-tight text-ink lg:text-6xl">{value}</p>
      <p className="mt-4 text-base text-ink">{label}</p>
      {hint ? <p className={clsx('mt-1 text-sm', tone === 'warn' ? 'text-warn' : 'text-muted')}>{hint}</p> : null}
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-3 font-mono text-xs leading-relaxed text-muted">
      <span aria-hidden className="mt-2 h-px w-8 shrink-0 bg-ink/30" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}
