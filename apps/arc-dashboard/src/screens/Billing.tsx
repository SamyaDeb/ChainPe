import { useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { isAddress, type Address } from 'viem'
import { useAccount } from 'wagmi'
import { Check, CheckCircle2, CircleDashed, Loader2, MinusCircle, AlertTriangle, XCircle } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useMe } from '@/auth/useMe'
import { CATCHING_UP, useUpgrade, type Step, type StepState } from '@/billing/useUpgrade'
import { TxLink } from '@/components/ui/Address'
import { PlanBadge } from '@/components/ui/Badges'
import { Card, Note, PageHeader, SectionTitle } from '@/components/ui/Card'
import { Button, Field, inputCls } from '@/components/ui/forms'
import { ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { accountsAbi, MAX_PERIODS, PERIOD_DAYS, usdcAbi } from '@/lib/accounts'
import { ACCOUNTS_ADDRESS, ARC_NETWORK, USDC_ADDRESS, USE_MOCK } from '@/lib/env'
import { formatUsdc, formatUsdcExact } from '@/lib/money'
import { formatDate } from '@/lib/time'
import { switchToArc } from '@/lib/wagmi'
import { errorText, isUserRejection, publicClient } from '@/lib/wallet'

const FREE_FEATURES = ['Revenue for 24 hours and 7 days', 'Payments from the last 7 days', 'Your oldest active service', 'Top 5 buyers', 'Latest doctor result', 'Rating averages']
const PRO_FEATURES = ['30 day, 90 day and all-time ranges', 'Full payment history and CSV export', 'All services', 'All buyers with first and last seen', 'Doctor history, last 100 reports', 'Every review']

const stepIcon: Record<StepState, JSX.Element> = {
  idle: <CircleDashed size={16} className="text-muted" aria-hidden />,
  active: <Loader2 size={16} className="animate-spin text-accent" aria-hidden />,
  done: <CheckCircle2 size={16} className="text-ok" aria-hidden />,
  skipped: <MinusCircle size={16} className="text-muted" aria-hidden />,
  warn: <AlertTriangle size={16} className="text-warn" aria-hidden />,
  error: <XCircle size={16} className="text-bad" aria-hidden />,
}

const stepWord: Record<StepState, string> = { idle: 'Waiting', active: 'In progress', done: 'Done', skipped: 'Skipped', warn: 'Check later', error: 'Failed' }

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5">{stepIcon[step.state]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {step.label} <span className="font-normal text-muted">({stepWord[step.state]})</span>
        </p>
        {step.hash ? <TxLink hash={step.hash} label={`${step.label} transaction`} /> : null}
        {step.note ? (
          <p role={step.state === 'error' ? 'alert' : 'status'} className={`text-sm ${step.state === 'error' ? 'text-bad' : 'text-muted'}`}>
            {step.note}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/** One plan, laid out like a column of the landing page's pricing table. The plan you are on gets the heavy rule. */
function PlanColumn({ title, items, current }: { title: string; items: string[]; current: boolean }) {
  return (
    <div className={`relative bg-bg p-6 lg:p-10 ${current ? 'outline outline-2 -outline-offset-2 outline-ink' : ''}`}>
      {current ? <span className="absolute left-6 top-0 -translate-y-1/2 bg-accent px-3 py-1 font-mono text-xs text-accent-fg lg:left-10">Your plan</span> : null}
      <p className="mb-6 border-b border-ink/10 pb-6 font-display text-5xl tracking-tight text-ink lg:text-6xl">{title}</p>
      <ul className="flex flex-col gap-3 text-sm text-muted">
        {items.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <Check size={16} className="mt-0.5 shrink-0 text-ink" aria-hidden /> {f}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface ChainState {
  price: bigint
  balance: bigint | null
  allowance: bigint | null
  /** planOf(address): 1 = Pro, 0 = Free. Null when it was not read. */
  onchainPlan: number | null
}

function configProblem(): string | null {
  if (ARC_NETWORK !== 'arc-testnet') return 'This build supports Arc testnet only. Set VITE_ARC_NETWORK=arc-testnet.'
  if (!isAddress(ACCOUNTS_ADDRESS)) return 'VITE_ACCOUNTS_ADDRESS is missing or not a valid address.'
  if (!isAddress(USDC_ADDRESS)) return 'VITE_USDC_ADDRESS is missing or not a valid address.'
  return null
}

function Purchase({ chain, reload }: { chain: ChainState; reload: () => void }) {
  const me = useMe()
  const { session, refreshMe } = useAuth()
  const [periods, setPeriods] = useState(1)
  const upgrade = useUpgrade({ me, address: session?.address ?? me.address, refreshMe, onDone: reload })
  const total = chain.price * BigInt(periods)
  const { isConnected: hasWallet } = useAccount()
  const { openConnectModal } = useConnectModal()
  const short = chain.balance !== null && chain.balance < total
  const verb = me.plan === 'pro' ? 'Extend Pro' : 'Upgrade to Pro'

  return (
    <Card>
      <SectionTitle>{verb}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Number of 30-day periods" htmlFor="periods" hint={`1 to ${MAX_PERIODS}. Each period is ${PERIOD_DAYS} days.`}>
          <select id="periods" className={inputCls} value={periods} disabled={upgrade.running} onChange={(e) => setPeriods(Number(e.target.value))}>
            {Array.from({ length: MAX_PERIODS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'period' : 'periods'} ({n * PERIOD_DAYS} days)
              </option>
            ))}
          </select>
        </Field>
        <dl className="grid grid-cols-2 items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Price per period</dt>
          <dd className="text-right font-medium tabular-nums">{formatUsdcExact(chain.price)} USDC</dd>
          <dt className="text-muted">Total</dt>
          <dd className="text-right font-display text-4xl tracking-tight">{formatUsdcExact(total)} USDC</dd>
          <dt className="text-muted">Your USDC balance</dt>
          <dd className="text-right tabular-nums">{chain.balance === null ? 'Not shown in sample mode' : `${formatUsdc(chain.balance)} USDC`}</dd>
          <dt className="text-muted">Allowance for ChainPe</dt>
          <dd className="text-right tabular-nums">{chain.allowance === null ? '\u2014' : `${formatUsdc(chain.allowance)} USDC`}</dd>
        </dl>
      </div>

      {short ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          Your USDC balance is below the total. Add test USDC, then try again.
        </p>
      ) : null}
      {USE_MOCK ? <p className="mt-3 text-sm text-muted">Paying is turned off in sample mode. Run with a live backend to upgrade.</p> : null}
      {!hasWallet && !USE_MOCK ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Reconnect the wallet you signed in with to pay with USDC.</p>
          <Button onClick={() => openConnectModal?.()}>Connect wallet</Button>
        </div>
      ) : null}

      <Button variant="primary" className="mt-6" disabled={USE_MOCK || !hasWallet || short || upgrade.running || upgrade.sent} onClick={() => void upgrade.run(periods)}>
        {upgrade.running ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
        {verb}: pay {formatUsdcExact(total)} USDC
      </Button>
      {upgrade.sent ? (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-3 border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          <span className="min-w-0 flex-1">Your subscription transaction was sent and its result is not known yet. Paying again is turned off until it is.</span>
          <Button disabled={upgrade.checking} onClick={() => void upgrade.recheck()}>
            {upgrade.checking ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Check again
          </Button>
        </div>
      ) : null}

      {upgrade.started ? (
        <ol aria-label="Upgrade progress" className="mt-6 divide-y divide-ink/10 border border-ink/10 px-4">
          {upgrade.steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ol>
      ) : null}
    </Card>
  )
}

function AddNetwork() {
  const [state, setState] = useState<'idle' | 'added' | { error: string }>('idle')
  const { isConnected } = useAccount()
  const add = async () => {
    try {
      await switchToArc()
      setState('added')
    } catch (e) {
      setState({ error: isUserRejection(e) ? 'You declined the request in your wallet.' : errorText(e) })
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={() => void add()} disabled={!isConnected}>
        Add Arc testnet to wallet
      </Button>
      {!isConnected ? <p className="text-sm text-muted">No wallet is connected.</p> : null}
      {state === 'added' ? <p role="status" className="text-sm text-ok">Arc testnet is in your wallet.</p> : null}
      {typeof state === 'object' ? <p role="alert" className="text-sm text-bad">{state.error}</p> : null}
    </div>
  )
}

export function Billing() {
  const me = useMe()
  const { session } = useAuth()
  const problem = configProblem()
  const address = session?.address
  const chain = useResource<ChainState>(
    `billing-chain-${address ?? ''}`,
    async () => {
      const price = await publicClient.readContract({ address: ACCOUNTS_ADDRESS as Address, abi: accountsAbi, functionName: 'proPricePerPeriod' })
      if (USE_MOCK || !address) return { price, balance: null, allowance: null, onchainPlan: null }
      const owner = address as Address
      const [balance, allowance, onchainPlan] = await Promise.all([
        publicClient.readContract({ address: USDC_ADDRESS as Address, abi: usdcAbi, functionName: 'balanceOf', args: [owner] }),
        publicClient.readContract({ address: USDC_ADDRESS as Address, abi: usdcAbi, functionName: 'allowance', args: [owner, ACCOUNTS_ADDRESS as Address] }),
        publicClient.readContract({ address: ACCOUNTS_ADDRESS as Address, abi: accountsAbi, functionName: 'planOf', args: [owner] }),
      ])
      return { price, balance, allowance, onchainPlan }
    },
    { enabled: problem === null },
  )

  return (
    <>
      <PageHeader title="Billing" subtitle="Pay with USDC on Arc testnet. Only your wallet signs." />
      <div className="flex flex-col gap-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <PlanBadge plan={me.plan} />
              <span className="text-sm text-muted">
                {me.plan === 'pro' ? `Paid until ${formatDate(me.paidUntil)}` : 'No active Pro period'}
              </span>
            </div>
            <AddNetwork />
          </div>
          {chain.data?.onchainPlan != null ? (
            <p className="mt-3 text-sm text-muted">On-chain plan: {chain.data.onchainPlan === 1 ? 'Pro' : 'Free'}</p>
          ) : null}
          {chain.data?.onchainPlan === 1 && me.plan === 'free' ? (
            <p role="status" className="mt-1 text-sm font-medium text-warn">
              {CATCHING_UP}
            </p>
          ) : null}
        </Card>
        <div className="rise grid gap-px border border-ink/10 bg-ink/10 sm:grid-cols-2">
          <PlanColumn title="Free" items={FREE_FEATURES} current={me.plan === 'free'} />
          <PlanColumn title="Pro" items={PRO_FEATURES} current={me.plan === 'pro'} />
        </div>

        {problem ? (
          <Card as="div" className="border-bad">
            <p className="font-display text-3xl tracking-tight text-ink">Billing is not configured</p>
            <p role="alert" className="mt-1 text-sm text-muted">{problem}</p>
          </Card>
        ) : (
          <ResourceView resource={chain} skeletonRows={3}>
            {(d) => <Purchase chain={d} reload={chain.reload} />}
          </ResourceView>
        )}
        <Note>Each period is {PERIOD_DAYS} days. Extending adds time after your current paid-until date.</Note>
      </div>
    </>
  )
}
