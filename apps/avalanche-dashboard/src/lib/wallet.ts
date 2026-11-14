import { createPublicClient, http, type PublicClient } from 'viem'
import { avalanche } from 'viem/chains'

export const AVALANCHE_RPC_URL = 'https://api.avax.network/ext/bc/C/rpc'

/** Avalanche C-Chain mainnet. Gas is AVAX; USDC is the native Circle ERC-20 with 6 decimals. */
export const avalancheChain = avalanche

export const publicClient: PublicClient = createPublicClient({
  chain: avalancheChain,
  transport: http(AVALANCHE_RPC_URL),
})

/** Finds an EIP-1193 error code on an error or any of its causes. */
export function errorCode(e: unknown): number | null {
  let cur: unknown = e
  for (let i = 0; i < 5 && typeof cur === 'object' && cur !== null; i += 1) {
    const { code, cause } = cur as { code?: unknown; cause?: unknown }
    if (typeof code === 'number') return code
    cur = cause
  }
  return null
}

/** 4001 is the EIP-1193 rejection. 5000 is the same thing from a wallet paired over WalletConnect. */
export function isUserRejection(e: unknown): boolean {
  const code = errorCode(e)
  return code === 4001 || code === 5000
}

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const short = (e as { shortMessage?: unknown }).shortMessage
    return typeof short === 'string' ? short : e.message
  }
  return 'Something went wrong.'
}
