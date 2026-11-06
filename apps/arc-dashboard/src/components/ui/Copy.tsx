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
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-300 hover:bg-ink/5 hover:text-ink"
    >
      {state === 'copied' ? <Check size={16} className="text-ok" aria-hidden /> : <Copy size={16} aria-hidden />}
    </button>
  )
}

/** A shell command the user is meant to run, with a copy button. */
export function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border border-ink/10 bg-subtle py-1.5 pl-4 pr-1.5">
      <code className="min-w-0 break-all font-mono text-sm text-ink">
        <span aria-hidden className="mr-2 select-none text-muted">$</span>
        {command}
      </code>
      <CopyButton value={command} label="command" />
    </div>
  )
}
