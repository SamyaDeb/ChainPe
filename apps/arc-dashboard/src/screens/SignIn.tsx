import { Loader2, Wallet } from 'lucide-react'
import { useAuth, type AuthIssue, type MockScenario, type SignInStep } from '@/auth/AuthContext'
import { MockBanner } from '@/components/MockBanner'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Card } from '@/components/ui/Card'
import { CommandBlock } from '@/components/ui/Copy'
import { Button } from '@/components/ui/forms'
import { useNow } from '@/hooks/useNow'

export const REGISTER_COMMAND = 'npx @chainpeavax/cli register --network arc-testnet'

const STEP_TEXT: Record<SignInStep, string> = {
  idle: '',
  connecting: 'Waiting for your wallet to share an account.',
  nonce: 'Requesting a sign-in message.',
  signing: 'Review the message below and sign it in your wallet. This does not move funds or cost gas.',
  verifying: 'Checking your signature.',
}

export function RegisterFirst({ onBack }: { onBack: () => void }) {
  return (
    <Card as="div" className="w-full max-w-md">
      <h1 className="text-xl font-semibold text-ink">Register first</h1>
      <p className="mt-2 text-sm text-muted">
        This wallet has no ChainPe provider account yet. Register it from your terminal, then sign in again.
      </p>
      <div className="mt-4">
        <CommandBlock command={REGISTER_COMMAND} />
      </div>
      <Button className="mt-4" onClick={onBack}>
        Back to sign in
      </Button>
    </Card>
  )
}

function IssueNotice({ issue }: { issue: AuthIssue }) {
  const now = useNow(1000)
  const wait = issue.retryAt ? Math.max(0, Math.ceil((issue.retryAt - now) / 1000)) : 0
  const info = issue.kind === 'session_ended'
  return (
    <div
      role={info ? 'status' : 'alert'}
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${info ? 'border-line bg-subtle text-ink' : 'border-bad bg-bad-soft text-bad'}`}
    >
      {issue.kind === 'config' ? <p className="mb-1 font-semibold">Configuration error</p> : null}
      <p className="break-words">
        {issue.kind === 'rate_limited' ? (wait > 0 ? `${issue.message} Wait ${wait} s, then try again.` : `${issue.message} You can try again now.`) : issue.message}
      </p>
    </div>
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
      <Card as="div" className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-ink">ChainPe provider dashboard</h1>
        <p className="mt-2 text-sm text-muted">
          Sign in with the wallet you registered with. You only ever see your own services, revenue, buyers and ratings.
        </p>

        {mock ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">Choose a sample account</p>
            {(
              [
                ['pro', 'Pro provider'],
                ['free', 'Free provider'],
                ['unregistered', 'Unregistered wallet'],
              ] satisfies Array<[MockScenario, string]>
            ).map(([scenario, text]) => (
              <Button key={scenario} variant={scenario === 'pro' ? 'primary' : 'secondary'} disabled={busy} onClick={() => void auth.signInMock(scenario)}>
                {text}
              </Button>
            ))}
          </div>
        ) : (
          <Button variant="primary" className="mt-4 w-full" disabled={busy || waiting} onClick={() => void auth.signInWithWallet()}>
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
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-subtle p-3 font-mono text-xs text-ink">{pendingMessage}</pre>
        ) : null}
        {issue ? <IssueNotice issue={issue} /> : null}
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { mock } = useAuth()
  return (
    <div className="flex min-h-dvh flex-col">
      {mock ? <MockBanner /> : null}
      <div className="flex justify-end p-2">
        <ThemeToggle />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center">{children}</main>
    </div>
  )
}
