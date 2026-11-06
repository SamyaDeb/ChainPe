import type { ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle, ShieldAlert, XCircle } from 'lucide-react'
import type { Verification, VerificationReason } from '@/api/schema'
import type { CheckStatus } from '@/lib/doctor'

type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'accent' | 'solid'

const tones: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  neutral: 'bg-subtle text-muted',
  accent: 'border border-ink/20 text-ink',
  solid: 'bg-accent text-accent-fg',
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-xs', tones[tone])}>
      {children}
    </span>
  )
}

/** Verification is shown with an icon shape and text, never colour alone. */
export function VerificationBadge({ value }: { value: Verification }) {
  if (value === 'verified') {
    return (
      <Pill tone="ok">
        <CheckCircle2 size={12} aria-hidden /> Verified
      </Pill>
    )
  }
  if (value === 'failed') {
    return (
      <Pill tone="bad">
        <XCircle size={12} aria-hidden /> Failed
      </Pill>
    )
  }
  return (
    <Pill tone="warn">
      <CircleDashed size={12} aria-hidden /> Unverified
    </Pill>
  )
}

export function SelfPayBadge() {
  return (
    <Pill tone="neutral">
      <ShieldAlert size={12} aria-hidden /> Self-pay
    </Pill>
  )
}

const REASONS: Record<string, string> = {
  no_transfer_yet: 'No matching USDC transfer found yet. This can still turn verified.',
  not_completed: 'The call did not complete, so no payment is expected.',
  no_tx_hash: 'The proxy reported no transaction hash.',
  no_transfer_id: 'The proxy reported no Circle transfer id.',
  amount_mismatch: 'The transfer amount differs from the reported amount.',
  payer_mismatch: 'The transfer came from a different wallet than reported.',
  recipient_mismatch: 'The transfer went to a different address than your payout address.',
  asset_mismatch: 'The transfer was not in USDC.',
  already_claimed: 'This transfer was already counted for another call.',
  gateway_failed: 'Circle reported that the Gateway transfer failed. The call was served and you were not paid.',
}

export function explainVerification(verification: Verification, reason: VerificationReason, rail: string): string {
  if (verification === 'verified') {
    return rail === 'gateway'
      ? 'Matched to Circle\u2019s transfer record.'
      : 'Matched to a USDC transfer on Arc.'
  }
  if (reason && REASONS[reason]) return REASONS[reason]
  if (reason) return 'Not verified for an unrecognised reason.'
  return 'Not verified yet.'
}

const checkTones: Record<CheckStatus, { tone: Tone; label: string; icon: ReactNode }> = {
  pass: { tone: 'ok', label: 'Pass', icon: <CheckCircle2 size={12} aria-hidden /> },
  warn: { tone: 'warn', label: 'Warning', icon: <AlertTriangle size={12} aria-hidden /> },
  fail: { tone: 'bad', label: 'Fail', icon: <XCircle size={12} aria-hidden /> },
  unknown: { tone: 'warn', label: 'Unknown', icon: <CircleDashed size={12} aria-hidden /> },
  skip: { tone: 'neutral', label: 'Skipped', icon: <MinusCircle size={12} aria-hidden /> },
  info: { tone: 'accent', label: 'Info', icon: <Info size={12} aria-hidden /> },
}

export function CheckBadge({ status }: { status: CheckStatus }) {
  const c = checkTones[status]
  return (
    <Pill tone={c.tone}>
      {c.icon} {c.label}
    </Pill>
  )
}

export function PlanBadge({ plan }: { plan: 'free' | 'pro' }) {
  return <Pill tone={plan === 'pro' ? 'solid' : 'accent'}>{plan === 'pro' ? 'Pro plan' : 'Free plan'}</Pill>
}
