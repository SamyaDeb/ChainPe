import { formatUsdc } from '@/lib/money'

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Letters arrive one at a time. Hidden from screen readers: pair it with the plain text. */
export function CharIn({ text, className }: { text: string; className?: string }) {
  return (
    <span key={text} aria-hidden className={`char-in inline-flex flex-wrap ${className ?? ''}`}>
      {Array.from(text).map((char, i) => (
        <span key={`${i}-${char}`}>{char === ' ' ? ' ' : char}</span>
      ))}
    </span>
  )
}

/** A USDC amount, always the real value. Anything that is not a valid amount shows the usual dash. */
export function CountUsdc({ value }: { value: string | null | undefined }) {
  return <>{formatUsdc(value)}</>
}

/** A whole number, always the real value. */
export function CountInt({ value }: { value: number }) {
  if (!Number.isSafeInteger(value) || value < 0) return <>{value}</>
  return <>{value.toLocaleString()}</>
}
