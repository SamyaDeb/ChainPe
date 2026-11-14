import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export const inputCls =
  'h-12 w-full rounded border border-ink/20 bg-transparent px-3 text-sm text-ink transition-colors duration-300 placeholder:text-muted hover:border-ink/40 focus:border-ink'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90',
  secondary: 'border border-ink/20 text-ink hover:border-ink hover:bg-ink/5',
  danger: 'bg-bad text-accent-fg hover:bg-bad/90',
  ghost: 'text-ink hover:bg-ink/5',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...rest}
    />
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

interface Option<V extends string> {
  value: V
  label: string
  locked?: boolean
}

/** A group of toggle buttons drawn as pills. It wraps instead of scrolling. */
export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: Array<Option<V>>
  onChange: (v: V) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-full flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'min-h-10 shrink-0 rounded-full border px-4 text-sm transition-colors duration-300',
              active ? 'border-accent bg-accent text-accent-fg' : 'border-ink/20 bg-bg text-ink hover:border-ink',
            )}
          >
            {o.label}
            {o.locked ? <span className="ml-1 font-mono text-xs">(Pro)</span> : null}
          </button>
        )
      })}
    </div>
  )
}
