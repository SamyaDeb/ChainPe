import { useEffect, useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ArrowRight, Loader2, QrCode, Wallet } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useAuth, type AuthIssue, type MockScenario, type SignInStep } from '@/auth/AuthContext'
import { AnimatedSphere } from '@/components/AnimatedSphere'
import { MockBanner } from '@/components/MockBanner'
import { ThemeToggle } from '@/components/ThemeToggle'
import { AddressView } from '@/components/ui/Address'
import { Eyebrow } from '@/components/ui/Card'
import { CommandBlock } from '@/components/ui/Copy'
import { Button } from '@/components/ui/forms'
import { CharIn, prefersReducedMotion } from '@/components/ui/Motion'
import { useNow } from '@/hooks/useNow'
import { disconnectAll, QR_ENABLED } from '@/lib/wagmi'

export const INIT_COMMAND = 'npx @chainpeavax/cli init'
export const REGISTER_COMMAND = 'npx @chainpeavax/cli register'

const WORDS = ['paid', 'rated', 'listed', 'verified']
const WORD_MS = 2500

const STEP_TEXT: Record<SignInStep, string> = {
  idle: '',
  nonce: 'Requesting a sign-in message.',
  signing: 'Review the message below and sign it in your wallet. On a phone wallet, open the app to approve. This does not move funds or cost gas.',
  verifying: 'Checking your signature.',
}

const panelCls = 'rise relative w-full border border-ink bg-bg p-6 lg:p-10'

/** On Avalanche a provider is a wallet with a service in ChainPeRegistry, and registering one is done from the CLI. */
export function RegisterFirst({ onBack, onRegistered }: { onBack: () => void; onRegistered: () => void }) {
  return (
    <div className={panelCls}>
      <h2 className="font-display text-4xl tracking-tight text-ink lg:text-5xl">Register first</h2>
      <p className="mt-3 text-muted">
        This wallet has no service in the ChainPe registry on Avalanche yet. List one from your terminal with the same wallet. The registry charges a one-time 1 USDC fee, plus a little AVAX for gas.
      </p>
      <ol className="mt-6 flex flex-col gap-4 text-sm text-muted">
        <li>
          <p className="mb-2">1. Set up your service. When asked for the network, pick Avalanche (mainnet):</p>
          <CommandBlock command={INIT_COMMAND} />
        </li>
        <li>
          <p className="mb-2">2. Register it on-chain:</p>
          <CommandBlock command={REGISTER_COMMAND} />
        </li>
      </ol>
      <p className="mt-6 text-sm text-muted">Once the transaction confirms, come back and sign in. A new listing can take a minute to show up here.</p>
      <Button variant="primary" className="mt-4 w-full" onClick={onRegistered}>
        I registered, sign in
      </Button>
      <Button className="mt-3" onClick={onBack}>
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
  const wallet = useAccount()
  const { openConnectModal } = useConnectModal()
  const busy = step !== 'idle'
  const now = useNow(1000)
  const waiting = issue?.kind === 'rate_limited' && issue.retryAt !== undefined && issue.retryAt > now

  if (issue?.kind === 'not_registered') {
    return (
      <Shell>
        <RegisterFirst
          onBack={auth.dismissIssue}
          onRegistered={() => {
            auth.dismissIssue()
            void auth.signInWithWallet()
          }}
        />
      </Shell>
    )
  }

  const label = issue?.kind === 'invalid_siwe' ? 'Get a new message and retry' : issue?.kind === 'chain_unavailable' ? 'Retry' : 'Sign in'
  const connected = wallet.status === 'connected'
  const connecting = wallet.status === 'connecting' || wallet.status === 'reconnecting'

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
                ['pro', 'Sample provider'],
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
          <>
            {connected ? (
              <>
                {/* A second tap on purpose: a phone browser only opens the wallet app from a user gesture. */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border border-ink/10 px-3 py-2 text-sm">
                  <span className="text-muted">Connected</span>
                  <AddressView address={wallet.address} />
                </div>
                <Button variant="primary" className="mt-3 w-full" disabled={busy || waiting} onClick={() => void auth.signInWithWallet()}>
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
                  {busy ? 'Working' : label}
                </Button>
                <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={() => void disconnectAll()}>
                  Use a different wallet
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" className="mt-6 w-full" disabled={connecting || waiting} onClick={() => openConnectModal?.()}>
                  {connecting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Wallet size={16} aria-hidden />}
                  {connecting ? 'Connecting' : 'Connect wallet'}
                </Button>
                {QR_ENABLED ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <QrCode size={16} aria-hidden /> MetaMask, Rainbow, or scan a QR code with a phone wallet.
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-muted">Browser wallets only. QR sign-in is not configured for this build.</p>
                )}
              </>
            )}
          </>
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
            <Eyebrow>Provider dashboard on Avalanche</Eyebrow>
          </div>
          <h1 className="font-display text-[clamp(3rem,10vw,8.5rem)] leading-[0.95] tracking-tight text-ink">
            <span className="sr-only">ChainPe provider dashboard</span>
            <span aria-hidden className="block">Your services,</span>
            <span aria-hidden className="block">
              <RotatingWord />
            </span>
          </h1>
          <p className="mt-10 max-w-xl text-xl leading-relaxed text-muted">See who pays your API, what settled on Avalanche, and how agents rate you.</p>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  )
}
