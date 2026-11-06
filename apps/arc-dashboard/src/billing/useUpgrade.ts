import { useCallback, useEffect, useRef, useState } from 'react'
import { getAddress, isAddressEqual, type Address, type Hash } from 'viem'
import { getAccount, getWalletClient } from 'wagmi/actions'
import type { Me } from '@/api/schema'
import { accountsAbi, usdcAbi } from '@/lib/accounts'
import { ACCOUNTS_ADDRESS, USDC_ADDRESS } from '@/lib/env'
import { formatUsdcExact } from '@/lib/money'
import { switchToArc, wagmiConfig } from '@/lib/wagmi'
import { arcTestnet, errorText, isUserRejection, publicClient } from '@/lib/wallet'

export type StepId = 'network' | 'approve' | 'subscribe' | 'sync'
export type StepState = 'idle' | 'active' | 'done' | 'skipped' | 'warn' | 'error'

export interface Step {
  id: StepId
  label: string
  state: StepState
  hash?: Hash
  note?: string
}

const INITIAL: Step[] = [
  { id: 'network', label: 'Switch to Arc testnet', state: 'idle' },
  { id: 'approve', label: 'Approve USDC for ChainPe Accounts', state: 'idle' },
  { id: 'subscribe', label: 'Subscribe to Pro', state: 'idle' },
  { id: 'sync', label: 'Dashboard picks up the new plan', state: 'idle' },
]

const POLL_MS = 3000
const POLL_LIMIT_MS = 90_000

class StepFailure extends Error {}

export const UNREADABLE_RECEIPT = 'This transaction was sent, but its result could not be read. Check the link before paying again.'
/** Shown when the chain says Pro but /v1/me has not caught up yet. */
export const CATCHING_UP = 'Your payment is on-chain and the dashboard is catching up'

/** A hash exists, so the transaction may have landed. This is not a failed payment. */
class UnreadableReceipt extends StepFailure {
  constructor() {
    super(UNREADABLE_RECEIPT)
  }
}

async function receiptStatus(hash: Hash): Promise<'success' | 'reverted'> {
  try {
    return (await publicClient.waitForTransactionReceipt({ hash })).status
  } catch {
    throw new UnreadableReceipt()
  }
}

interface Args {
  me: Me
  address: string
  refreshMe: () => Promise<Me | null>
  onDone: () => void
}

function isUpgraded(before: Me, now: Me): boolean {
  if (now.plan !== 'pro') return false
  if (before.plan !== 'pro') return true
  const was = before.paidUntil ? Date.parse(before.paidUntil) : 0
  const is = now.paidUntil ? Date.parse(now.paidUntil) : 0
  return is > was
}

/** The two-transaction upgrade: approve USDC, then subscribe. Only the user's wallet signs. */
export function useUpgrade({ me, address, refreshMe, onDone }: Args) {
  const [steps, setSteps] = useState<Step[]>(INITIAL)
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [sent, setSent] = useState(false)
  const [checking, setChecking] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const patch = useCallback((id: StepId, change: Partial<Step>) => {
    if (!alive.current) return
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...change } : s)))
  }, [])

  const syncPlan = useCallback(async () => {
    patch('sync', { state: 'active' })
    const deadline = Date.now() + POLL_LIMIT_MS
    let upgraded = false
    while (alive.current && Date.now() < deadline) {
      const latest = await refreshMe()
      if (latest && isUpgraded(me, latest)) {
        upgraded = true
        break
      }
      await new Promise((r) => window.setTimeout(r, POLL_MS))
    }
    if (upgraded) patch('sync', { state: 'done' })
    else patch('sync', { state: 'warn', note: `${CATCHING_UP}. This can take a minute. Reload to check again.` })
  }, [me, patch, refreshMe])

  const run = useCallback(
    async (periods: number) => {
      let current: StepId = 'network'
      setSteps(INITIAL)
      setStarted(true)
      setRunning(true)
      try {
        const account = getAccount(wagmiConfig).address
        if (!account) throw new StepFailure('Connect your wallet first.')
        if (!isAddressEqual(account, address as Address)) {
          throw new StepFailure('Your wallet is on a different account than the one you signed in with. Switch accounts, then sign in again.')
        }

        patch('network', { state: 'active' })
        await switchToArc()
        const wallet = await getWalletClient(wagmiConfig, { chainId: arcTestnet.id })
        patch('network', { state: 'done' })
        current = 'approve'

        const accountsContract = getAddress(ACCOUNTS_ADDRESS)
        const usdc = getAddress(USDC_ADDRESS)
        const price = await publicClient.readContract({ address: accountsContract, abi: accountsAbi, functionName: 'proPricePerPeriod' })
        const total = price * BigInt(periods)
        const [balance, allowance] = await Promise.all([
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'balanceOf', args: [account] }),
          publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [account, accountsContract] }),
        ])
        if (balance < total) {
          throw new StepFailure(`Not enough USDC. You need ${formatUsdcExact(total)} and your wallet holds ${formatUsdcExact(balance)}.`)
        }

        if (allowance < total) {
          patch('approve', { state: 'active' })
          const hash = await wallet.writeContract({ address: usdc, abi: usdcAbi, functionName: 'approve', args: [accountsContract, total], account, chain: arcTestnet })
          patch('approve', { hash })
          if ((await receiptStatus(hash)) !== 'success') throw new StepFailure('The approval transaction reverted.')
          patch('approve', { state: 'done' })
        } else {
          patch('approve', { state: 'skipped', note: 'Existing allowance already covers this payment.' })
        }

        current = 'subscribe'
        patch('subscribe', { state: 'active' })
        const hash = await wallet.writeContract({ address: accountsContract, abi: accountsAbi, functionName: 'subscribe', args: [periods], account, chain: arcTestnet })
        patch('subscribe', { hash })
        if (alive.current) setSent(true)
        const status = await receiptStatus(hash)
        if (alive.current) setSent(false)
        if (status !== 'success') throw new StepFailure('The subscription transaction reverted.')
        patch('subscribe', { state: 'done' })

        current = 'sync'
        await syncPlan()
      } catch (e) {
        if (e instanceof UnreadableReceipt) {
          patch(current, { state: 'warn', note: e.message })
        } else {
          const message = e instanceof StepFailure ? e.message : isUserRejection(e) ? 'You rejected the request in your wallet. Nothing was sent.' : errorText(e)
          patch(current, { state: 'error', note: message })
        }
      } finally {
        if (alive.current) setRunning(false)
        onDone()
      }
    },
    [address, onDone, patch, syncPlan],
  )

  /** Re-reads the subscribe receipt by hash. Clears `sent` once the outcome is known. */
  const recheck = useCallback(async () => {
    const hash = steps.find((s) => s.id === 'subscribe')?.hash
    if (!hash) return
    setChecking(true)
    try {
      let status: 'success' | 'reverted'
      try {
        status = (await publicClient.getTransactionReceipt({ hash })).status
      } catch {
        patch('subscribe', { state: 'warn', note: UNREADABLE_RECEIPT })
        return
      }
      if (alive.current) setSent(false)
      if (status !== 'success') {
        patch('subscribe', { state: 'error', note: 'The subscription transaction reverted.' })
        return
      }
      patch('subscribe', { state: 'done', note: undefined })
      setRunning(true)
      await syncPlan()
    } finally {
      if (alive.current) {
        setChecking(false)
        setRunning(false)
      }
      onDone()
    }
  }, [onDone, patch, steps, syncPlan])

  return { steps, running, started, sent, checking, run, recheck }
}
