import { useEffect, useRef, useState } from 'react'
import { formatUsdc, parseAtomic } from '@/lib/money'

const COUNT_MS = 1600
const PROGRESS_STEPS = 1000

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Letters arrive one at a time. Hidden from screen readers: pair it with the plain text. */
export function CharIn({ text, className }: { text: string; className?: string }) {
  return (
    <span key={text} aria-hidden className={`char-in inline-flex flex-wrap ${className ?? ''}`}>
      {Array.from(text).map((char, i) => (
        <span key={`${i}-${char}`}>{char === ' ' ? ' ' : char}</span>
      ))}
    </span>
  )
}

/**
 * Counts up to `target` with the landing's cubic ease, and on to each new value after that.
 * Only the eased progress is a float. The amount stays a bigint at every frame.
 */
function useCountUp(target: bigint): bigint {
  const [shown, setShown] = useState(0n)
  const shownRef = useRef(0n)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (reduced) return
    const from = shownRef.current
    if (from === target) return
    const startedAt = performance.now()
    const raf = { id: 0 }
    const tick = (time: number) => {
      const progress = Math.min((time - startedAt) / COUNT_MS, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const step = BigInt(Math.round(eased * PROGRESS_STEPS))
      const next = from + ((target - from) * step) / BigInt(PROGRESS_STEPS)
      shownRef.current = next
      setShown(next)
      if (progress < 1) raf.id = requestAnimationFrame(tick)
    }
    raf.id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.id)
  }, [target, reduced])

  return reduced ? target : shown
}

function Counted({ target, format }: { target: bigint; format: (v: bigint) => string }) {
  const shown = useCountUp(target)
  return (
    <>
      <span className="sr-only">{format(target)}</span>
      <span aria-hidden>{format(shown)}</span>
    </>
  )
}

/** A USDC amount that counts up. Anything that is not a valid amount shows the usual dash. */
export function CountUsdc({ value }: { value: string | null | undefined }) {
  const atomic = parseAtomic(value)
  if (atomic === null) return <>{formatUsdc(value)}</>
  return <Counted target={atomic} format={formatUsdc} />
}

/** A whole number that counts up. */
export function CountInt({ value }: { value: number }) {
  if (!Number.isSafeInteger(value) || value < 0) return <>{value}</>
  return <Counted target={BigInt(value)} format={(v) => v.toLocaleString()} />
}
