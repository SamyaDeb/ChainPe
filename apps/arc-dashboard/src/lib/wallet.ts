import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type EIP1193Provider,
  type PublicClient,
  type WalletClient,
} from 'viem'

/** Arc testnet. Native gas is USDC with 18 decimals; the USDC ERC-20 has 6. */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
})

declare global {
  interface Window {
    ethereum?: EIP1193Provider
  }
}

export function getProvider(): EIP1193Provider | null {
  return typeof window !== 'undefined' && window.ethereum ? window.ethereum : null
}

export const publicClient: PublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http('https://rpc.testnet.arc.io'),
})

export function getWalletClient(provider: EIP1193Provider): WalletClient {
  return createWalletClient({ chain: arcTestnet, transport: custom(provider) })
}

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

export function isUserRejection(e: unknown): boolean {
  return errorCode(e) === 4001
}

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const short = (e as { shortMessage?: unknown }).shortMessage
    return typeof short === 'string' ? short : e.message
  }
  return 'Something went wrong.'
}

/** Switch to Arc testnet, adding it first when the wallet does not know it (error 4902). */
export async function ensureArcTestnet(provider: EIP1193Provider): Promise<void> {
  const wallet = getWalletClient(provider)
  try {
    await wallet.switchChain({ id: arcTestnet.id })
  } catch (e) {
    if (errorCode(e) !== 4902) throw e
    await wallet.addChain({ chain: arcTestnet })
    await wallet.switchChain({ id: arcTestnet.id })
  }
}

/** The "Add Arc testnet to wallet" button. */
export async function addArcTestnet(provider: EIP1193Provider): Promise<void> {
  await getWalletClient(provider).addChain({ chain: arcTestnet })
}
