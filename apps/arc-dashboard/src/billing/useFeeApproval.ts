import { useCallback, useState } from 'react'
import { getAddress, isAddressEqual, type Address, type Hash } from 'viem'
import { getAccount, getWalletClient } from 'wagmi/actions'
import { usdcAbi } from '@/lib/accounts'
import { FEES_ADDRESS, USDC_ADDRESS } from '@/lib/env'
import { switchToArc, wagmiConfig } from '@/lib/wagmi'
import { arcTestnet, errorText, isUserRejection, publicClient } from '@/lib/wallet'

export type ApprovalState =
  | { kind: 'idle' }
  | { kind: 'working'; hash?: Hash }
  | { kind: 'done'; hash: Hash; revoked: boolean }
  | { kind: 'error'; message: string; hash?: Hash }

/** Sets how much USDC ChainPeFees may pull. The spender comes from this build, never from the API. Zero revokes it. */
export function useFeeApproval({ address, onDone }: { address: string; onDone: () => void }) {
  const [state, setState] = useState<ApprovalState>({ kind: 'idle' })

  const approve = useCallback(
    async (amount: bigint) => {
      let hash: Hash | undefined
      setState({ kind: 'working' })
      try {
        const account = getAccount(wagmiConfig).address
        if (!account) throw new Error('Connect your wallet first.')
        if (!isAddressEqual(account, address as Address)) {
          throw new Error('Your wallet is on a different account than the one you signed in with. Switch accounts, then sign in again.')
        }
        await switchToArc()
        const wallet = await getWalletClient(wagmiConfig, { chainId: arcTestnet.id })
        hash = await wallet.writeContract({
          address: getAddress(USDC_ADDRESS),
          abi: usdcAbi,
          functionName: 'approve',
          args: [getAddress(FEES_ADDRESS), amount],
          account,
          chain: arcTestnet,
        })
        setState({ kind: 'working', hash })
        const { status } = await publicClient.waitForTransactionReceipt({ hash })
        if (status === 'success') setState({ kind: 'done', hash, revoked: amount === 0n })
        else setState({ kind: 'error', message: 'The approval transaction reverted.', hash })
      } catch (e) {
        setState({ kind: 'error', message: isUserRejection(e) ? 'You declined the request in your wallet. Nothing was sent.' : errorText(e), hash })
      } finally {
        onDone()
      }
    },
    [address, onDone],
  )

  return { state, approve }
}
