import { useCallback, useState } from 'react'
import { getAddress, type Hash } from 'viem'
import { getAccount, getWalletClient } from 'wagmi/actions'
import { accountsAbi } from '@/lib/accounts'
import { ACCOUNTS_ADDRESS } from '@/lib/env'
import { switchToArc, wagmiConfig } from '@/lib/wagmi'
import { arcTestnet, errorText, isUserRejection, publicClient } from '@/lib/wallet'

export type RegisterState =
  | { kind: 'idle' }
  | { kind: 'working'; hash?: Hash }
  | { kind: 'no_gas' }
  | { kind: 'done'; hash: Hash }
  | { kind: 'error'; message: string; hash?: Hash }

/** Creates the provider account from the connected wallet: one free registerProvider(0) call, gas in USDC. */
export function useRegisterProvider() {
  const [state, setState] = useState<RegisterState>({ kind: 'idle' })

  const register = useCallback(async () => {
    let hash: Hash | undefined
    setState({ kind: 'working' })
    try {
      const { address } = getAccount(wagmiConfig)
      if (!address) throw new Error('Connect your wallet first.')
      if ((await publicClient.getBalance({ address })) === 0n) {
        setState({ kind: 'no_gas' })
        return
      }
      await switchToArc()
      const wallet = await getWalletClient(wagmiConfig, { chainId: arcTestnet.id })
      hash = await wallet.writeContract({
        address: getAddress(ACCOUNTS_ADDRESS),
        abi: accountsAbi,
        functionName: 'registerProvider',
        args: [0n],
        account: address,
        chain: arcTestnet,
      })
      setState({ kind: 'working', hash })
      const { status } = await publicClient.waitForTransactionReceipt({ hash })
      if (status === 'success') setState({ kind: 'done', hash })
      else setState({ kind: 'error', message: 'The registration transaction reverted.', hash })
    } catch (e) {
      const message = isUserRejection(e) ? 'You declined the request in your wallet. Nothing was sent.' : errorText(e)
      setState({ kind: 'error', message, hash })
    }
  }, [])

  return { state, register }
}
