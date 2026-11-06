import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export const inputCls =
  'h-11 w-full rounded-md border border-edge bg-surface px-3 text-sm text-ink placeholder:text-muted sm:h-10'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50',
  secondary: 'border border-edge bg-surface text-ink hover:bg-subtle disabled:opacity-50',
  danger: 'bg-bad text-accent-fg hover:opacity-90 disabled:opacity-50',
  ghost: 'text-ink hover:bg-subtle disabled:opacity-50',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:cursor-not-allowed sm:min-h-10',
        variants[variant],
        className,
      )}
      {...rest}
    />
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
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

/** A group of toggle buttons drawn as a segmented control. It wraps instead of scrolling. */
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
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-edge bg-surface p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'min-h-9 shrink-0 rounded px-3 text-sm font-medium',
              active ? 'bg-accent text-accent-fg' : 'text-ink hover:bg-subtle',
            )}
          >
            {o.label}
            {o.locked ? <span className="ml-1 text-xs">(Pro)</span> : null}
          </button>
        )
      })}
    </div>
  )
}
