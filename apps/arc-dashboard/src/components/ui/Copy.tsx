import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const id = window.setTimeout(() => setState('idle'), 1600)
    return () => window.clearTimeout(id)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={state === 'copied' ? `${label} copied` : state === 'failed' ? `Could not copy ${label}` : `Copy ${label}`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-ink"
    >
      {state === 'copied' ? <Check size={16} className="text-ok" aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  )
}

/** A shell command the user is meant to run, with a copy button. */
export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-subtle py-1 pl-3 pr-1">
      <code className="min-w-0 break-all font-mono text-sm text-ink">{command}</code>
      <CopyButton value={command} label="command" />
    </div>
  )
}
