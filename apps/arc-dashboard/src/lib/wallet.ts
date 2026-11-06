import { createPublicClient, defineChain, http, type PublicClient } from 'viem'

export const ARC_RPC_URL = 'https://rpc.testnet.arc.io'

/** Where a new wallet gets test USDC. On Arc that is also its gas. */
export const FAUCET_URL = 'https://faucet.circle.com'

/** Arc testnet. Native gas is USDC with 18 decimals; the USDC ERC-20 has 6. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

export const publicClient: PublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
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
