import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, Wallet } from 'lucide-react'
import { useAuth, type AuthIssue, type MockScenario, type SignInStep } from '@/auth/AuthContext'
import { AnimatedSphere } from '@/components/AnimatedSphere'
import { MockBanner } from '@/components/MockBanner'
import { StudioMark } from '@/components/StudioMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Eyebrow } from '@/components/ui/Card'
import { CommandBlock } from '@/components/ui/Copy'
import { Button } from '@/components/ui/forms'
import { CharIn, prefersReducedMotion } from '@/components/ui/Motion'
import { useNow } from '@/hooks/useNow'

export const REGISTER_COMMAND = 'npx @chainpeavax/cli register --network arc-testnet'

const WORDS = ['paid', 'rated', 'listed', 'verified']
const WORD_MS = 2500

const STEP_TEXT: Record<SignInStep, string> = {
  idle: '',
  connecting: 'Waiting for your wallet to share an account.',
  nonce: 'Requesting a sign-in message.',
  signing: 'Review the message below and sign it in your wallet. This does not move funds or cost gas.',
  verifying: 'Checking your signature.',
}

const panelCls = 'rise relative w-full border border-ink bg-bg p-6 lg:p-10'

export function RegisterFirst({ onBack }: { onBack: () => void }) {
  return (
    <div className={panelCls}>
      <h2 className="font-display text-4xl tracking-tight text-ink lg:text-5xl">Register first</h2>
      <p className="mt-3 text-muted">This wallet has no ChainPe provider account yet. Register it from your terminal, then sign in again.</p>
      <div className="mt-6">
        <CommandBlock command={REGISTER_COMMAND} />
      </div>
      <Button className="mt-6" onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  )
}

function IssueNotice({ issue }: { issue: AuthIssue }) {
  const now = useNow(1000)
  const wait = issue.retryAt ? Math.max(0, Math.ceil((issue.retryAt - now) / 1000)) : 0
  const info = issue.kind === 'session_ended'
  return (
    <div role={info ? 'status' : 'alert'} className={`mt-4 border px-3 py-2 text-sm ${info ? 'border-ink/10 bg-subtle text-ink' : 'border-bad bg-bad-soft text-bad'}`}>
      {issue.kind === 'config' ? <p className="mb-1 font-semibold">Configuration error</p> : null}
      <p className="break-words">
        {issue.kind === 'rate_limited' ? (wait > 0 ? `${issue.message} Wait ${wait} s, then try again.` : `${issue.message} You can try again now.`) : issue.message}
      </p>
    </div>
  )
}

function RotatingWord() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % WORDS.length), WORD_MS)
    return () => window.clearInterval(id)
  }, [])
  return (
    <span className="relative inline-block">
      <CharIn text={WORDS[index] ?? ''} />
      <span aria-hidden className="absolute -bottom-2 left-0 right-0 h-3 bg-ink/10" />
    </span>
  )
}

export function SignIn() {
  const auth = useAuth()
  const { issue, step, pendingMessage, mock } = auth
  const busy = step !== 'idle'
  const now = useNow(1000)
  const waiting = issue?.kind === 'rate_limited' && issue.retryAt !== undefined && issue.retryAt > now

  if (issue?.kind === 'not_registered') {
    return (
      <Shell>
        <RegisterFirst onBack={auth.dismissIssue} />
      </Shell>
    )
  }

  const label = issue?.kind === 'invalid_siwe' ? 'Get a new message and retry' : issue?.kind === 'chain_unavailable' ? 'Retry' : 'Connect wallet and sign in'

  return (
    <Shell>
      <div className={panelCls}>
        <h2 className="font-display text-4xl tracking-tight text-ink lg:text-5xl">Sign in</h2>
        <p className="mt-3 text-muted">Use the wallet you registered with. You only ever see your own services, revenue, buyers and ratings.</p>

        {mock ? (
          <div className="mt-6 flex flex-col gap-3">
            <p className="font-mono text-sm text-muted">Choose a sample account</p>
            {(
              [
                ['pro', 'Pro provider'],
                ['free', 'Free provider'],
                ['unregistered', 'Unregistered wallet'],
              ] satisfies Array<[MockScenario, string]>
            ).map(([scenario, text]) => (
              <Button key={scenario} variant={scenario === 'pro' ? 'primary' : 'secondary'} className="group" disabled={busy} onClick={() => void auth.signInMock(scenario)}>
                {text}
                <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
              </Button>
            ))}
          </div>
        ) : (
          <Button variant="primary" className="mt-6 w-full" disabled={busy || waiting} onClick={() => void auth.signInWithWallet()}>
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
            {busy ? 'Working' : label}
          </Button>
        )}

        {busy ? (
          <p role="status" className="mt-3 text-sm text-muted">
            {STEP_TEXT[step]}
          </p>
        ) : null}
        {pendingMessage ? (
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all border border-ink/10 bg-subtle p-3 font-mono text-xs text-ink">{pendingMessage}</pre>
        ) : null}
        {issue ? <IssueNotice issue={issue} /> : null}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { mock } = useAuth()
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      {mock ? <MockBanner /> : null}
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -left-48 top-1/2 h-[640px] w-[640px] -translate-y-1/2 opacity-[0.15] lg:left-1/4 lg:h-[800px] lg:w-[800px]">
        <AnimatedSphere />
      </div>
      <header className="relative mx-auto flex h-20 w-full max-w-[1400px] items-center justify-between px-6 lg:px-12">
        <span className="font-brand text-[22px] font-semibold text-ink">ChainPe</span>
        <ThemeToggle />
      </header>
      <main className="relative mx-auto grid w-full max-w-[1400px] flex-1 items-center gap-12 px-6 py-10 lg:grid-cols-[3fr_2fr] lg:gap-24 lg:px-12">
        <div className="min-w-0">
          <div className="fade-in mb-8">
            <Eyebrow>Provider dashboard on Arc</Eyebrow>
          </div>
          <h1 className="font-display text-[clamp(3rem,10vw,8.5rem)] leading-[0.95] tracking-tight text-ink">
            <span className="sr-only">ChainPe provider dashboard</span>
            <span aria-hidden className="block">Your services,</span>
            <span aria-hidden className="block">
              <RotatingWord />
            </span>
          </h1>
          <p className="mt-10 max-w-xl text-xl leading-relaxed text-muted">See who pays your API, what settled on Arc, and how agents rate you.</p>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
      <footer className="relative flex justify-center px-6 pb-6 lg:justify-start lg:px-12">
        <StudioMark />
      </footer>
    </div>
  )
}
