import { useState } from 'react'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { Loader2 } from 'lucide-react'
import { isAddress, isAddressEqual } from 'viem'
import { useAccount } from 'wagmi'
import type { Fees } from '@/api/schema'
import { useAuth } from '@/auth/AuthContext'
import { useFeeApproval } from '@/billing/useFeeApproval'
import { TxLink } from '@/components/ui/Address'
import { Card, SectionTitle } from '@/components/ui/Card'
import { Button, Field, inputCls } from '@/components/ui/forms'
import { ResourceView } from '@/components/ui/States'
import { useResource } from '@/hooks/useResource'
import { FEES_ADDRESS, USE_MOCK } from '@/lib/env'
import { formatUsdc } from '@/lib/money'
import { formatDate } from '@/lib/time'

const CHOICES = [5, 20, 100]
const USDC = 1_000_000n

const percent = (bps: number) => `${bps / 100}%`
const STATUS: Record<Fees['batches'][number]['status'], string> = { pending: 'Pending', collected: 'Collected', failed: 'Failed, will retry' }

/** The spender in this build must be the one the service charges through. A mismatch stops the approval. */
function spenderProblem(fees: Fees): string | null {
  if (USE_MOCK) return 'Approving is turned off in sample mode.'
  if (!isAddress(FEES_ADDRESS)) return 'This build has no fee contract configured, so approving is turned off.'
  if (!fees.contract || !isAddress(fees.contract) || !isAddressEqual(fees.contract, FEES_ADDRESS)) {
    return 'The service reports a different fee contract than this build. Approving is turned off. Nothing was sent.'
  }
  return null
}

function Body({ fees, reload }: { fees: Fees; reload: () => void }) {
  const { session, me } = useAuth()
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [choice, setChoice] = useState(20)
  const { state, approve } = useFeeApproval({ address: session?.address ?? me?.address ?? '', onDone: reload })
  const problem = spenderProblem(fees)
  const working = state.kind === 'working'
  const allowance = fees.allowanceAtomic === null ? null : BigInt(fees.allowanceAtomic)

  return (
    <Card>
      <SectionTitle>Usage fee</SectionTitle>
      <p className="max-w-prose text-sm text-muted">
        {fees.contract ? 'ChainPe charges' : 'Nothing is charged today. ChainPe plans to charge'} {percent(fees.rates.freeBps)} of verified revenue on Free and {percent(fees.rates.proBps)} on Pro. Buyers still pay your wallet directly. Fees are collected in batches from the USDC you approve here, and never from anything else. Self-pay is not charged.
      </p>
      <dl className="mt-4 grid grid-cols-2 items-baseline gap-x-4 gap-y-2 text-sm sm:max-w-md">
        <dt className="text-muted">Your rate</dt>
        <dd className="text-right font-medium tabular-nums">{percent(fees.rateBps)}</dd>
        <dt className="text-muted">Owed</dt>
        <dd className="text-right font-medium tabular-nums">{formatUsdc(BigInt(fees.owedAtomic))} USDC</dd>
        <dt className="text-muted">Collected so far</dt>
        <dd className="text-right tabular-nums">{formatUsdc(BigInt(fees.collectedAtomic))} USDC</dd>
        <dt className="text-muted">Approved for ChainPe</dt>
        <dd className="text-right tabular-nums">{allowance === null ? 'Could not be read' : `${formatUsdc(allowance)} USDC`}</dd>
      </dl>
      {fees.status === 'not_enrolled' ? (
        <p className="mt-3 text-sm text-muted">You are not being charged. Charging starts for calls made after you approve USDC.</p>
      ) : (
        <p className="mt-3 text-sm text-muted">The dashboard locks at {formatUsdc(BigInt(fees.lockAtAtomic))} USDC owed. Your API and paid calls never stop.</p>
      )}
      {fees.locked ? (
        <p role="alert" className="mt-3 text-sm font-medium text-bad">
          Unpaid fees have reached the limit, so your data is locked. Approve enough USDC to cover {formatUsdc(BigInt(fees.owedAtomic))} USDC. It unlocks after the next collection.
        </p>
      ) : null}

      {problem ? (
        <p className="mt-4 text-sm text-muted">{problem}</p>
      ) : !isConnected ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">Reconnect the wallet you signed in with to approve USDC.</p>
          <Button onClick={() => openConnectModal?.()}>Connect wallet</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-44">
            <Field label="USDC to approve" htmlFor="fee-allowance" hint="This replaces the current amount. It is the most ChainPe can ever pull.">
              <select id="fee-allowance" className={inputCls} value={choice} disabled={working} onChange={(e) => setChoice(Number(e.target.value))}>
                {CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} USDC
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button variant="primary" disabled={working} onClick={() => void approve(BigInt(choice) * USDC)}>
            {working ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Approve {choice} USDC
          </Button>
          {allowance !== null && allowance > 0n ? (
            <Button disabled={working} onClick={() => void approve(0n)}>
              Revoke
            </Button>
          ) : null}
        </div>
      )}
      {state.kind === 'working' && state.hash ? <TxLink hash={state.hash} label="Approval transaction" /> : null}
      {state.kind === 'done' ? (
        <div role="status" className="mt-3 text-sm text-ok">
          {state.revoked ? 'Approval revoked. ChainPe can no longer pull USDC from this wallet. Fees on new calls are still recorded, and the dashboard locks at the limit.' : 'Approved.'} <TxLink hash={state.hash} label="Approval transaction" />
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <p role="alert" className="mt-3 break-words text-sm text-bad">
          {state.message}
        </p>
      ) : null}

      {fees.batches.length > 0 ? (
        <ul aria-label="Fee collections" className="mt-6 divide-y divide-ink/10 border border-ink/10 text-sm">
          {fees.batches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-muted">{formatDate(b.createdAt)}</span>
              <span className="tabular-nums">
                {formatUsdc(BigInt(b.feeAtomic))} USDC on {formatUsdc(BigInt(b.revenueAtomic))} USDC revenue
              </span>
              <span className="text-muted">{STATUS[b.status]}</span>
              {b.txHash ? <TxLink hash={b.txHash} label="Collection transaction" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

export function FeesCard() {
  const { api } = useAuth()
  const fees = useResource('fees', () => api.fees())
  // The service charges nothing when fees are off, so there is nothing to show.
  if (fees.data && !fees.data.enabled) return null
  return (
    <ResourceView resource={fees} skeletonRows={3}>
      {(d) => <Body fees={d} reload={fees.reload} />}
    </ResourceView>
  )
}
