import { useCallback, useEffect, useRef, useState } from 'react'
import { getAddress, isAddressEqual, type Address, type Hash } from 'viem'
import type { Me } from '@/api/schema'
import { accountsAbi, usdcAbi } from '@/lib/accounts'
import { ACCOUNTS_ADDRESS, USDC_ADDRESS } from '@/lib/env'
import { formatUsdcExact } from '@/lib/money'
import { arcTestnet, ensureArcTestnet, errorText, getProvider, getWalletClient, isUserRejection, publicClient } from '@/lib/wallet'

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

  const run = useCallback(
    async (periods: number) => {
      const provider = getProvider()
      let current: StepId = 'network'
      setSteps(INITIAL)
      setStarted(true)
      setRunning(true)
      try {
        if (!provider) throw new StepFailure('No browser wallet was found. Install MetaMask or Rabby.')
        const wallet = getWalletClient(provider)
        const accounts = await wallet.requestAddresses()
        const account = accounts[0]
        if (!account || !isAddressEqual(account, address as Address)) {
          throw new StepFailure('Your wallet is on a different account than the one you signed in with. Switch accounts, then sign in again.')
        }

        patch('network', { state: 'active' })
        await ensureArcTestnet(provider)
        patch('network', { state: 'done' })

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

        current = 'approve'
        if (allowance < total) {
          patch('approve', { state: 'active' })
          const hash = await wallet.writeContract({ address: usdc, abi: usdcAbi, functionName: 'approve', args: [accountsContract, total], account, chain: arcTestnet })
          patch('approve', { hash })
          const receipt = await publicClient.waitForTransactionReceipt({ hash })
          if (receipt.status !== 'success') throw new StepFailure('The approval transaction reverted.')
          patch('approve', { state: 'done' })
        } else {
          patch('approve', { state: 'skipped', note: 'Existing allowance already covers this payment.' })
        }

        current = 'subscribe'
        patch('subscribe', { state: 'active' })
        const hash = await wallet.writeContract({ address: accountsContract, abi: accountsAbi, functionName: 'subscribe', args: [periods], account, chain: arcTestnet })
        patch('subscribe', { hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new StepFailure('The subscription transaction reverted.')
        patch('subscribe', { state: 'done' })

        current = 'sync'
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
        else patch('sync', { state: 'warn', note: 'Your payment landed on Arc and the dashboard is catching up. This can take a minute. Reload to check again.' })
      } catch (e) {
        const message = e instanceof StepFailure ? e.message : isUserRejection(e) ? 'You rejected the request in your wallet. Nothing was sent.' : errorText(e)
        patch(current, { state: 'error', note: message })
      } finally {
        if (alive.current) setRunning(false)
        onDone()
      }
    },
    [address, me, onDone, patch, refreshMe],
  )

  return { steps, running, started, run }
}
