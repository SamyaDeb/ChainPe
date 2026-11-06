/**
 * Everything the API reads from Arc, behind one interface so tests can stand in
 * for the RPC. Failures throw: a caller must never read one as "not registered".
 */
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain, http, parseAbi, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainPeAccountsAbi } from './accountsAbi.js'
import type { Env } from './config.js'

const OWNER_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)'])

export interface ProviderOnChain {
  exists: boolean
  agentId: bigint
  createdAt: bigint
  paidUntil: bigint
}

export interface SiweCheck {
  message: string
  signature: `0x${string}`
  domain: string
  nonce: string
  address: `0x${string}`
  time: Date
}

export interface ChainReader {
  getProvider(address: `0x${string}`): Promise<ProviderOnChain>
  planOf(address: `0x${string}`): Promise<number>
  /** Null when the token does not exist or the call reverts; throws when the RPC is unreachable. */
  ownerOf(agentId: bigint): Promise<string | null>
  /** The provider of a service key, or null if the key is unknown. */
  serviceProvider(key: `0x${string}`): Promise<string | null>
  /** ecrecover for an EOA, ERC-1271 for a smart account. False for a bad signature; throws when the RPC is unreachable. */
  verifySiwe(check: SiweCheck): Promise<boolean>
}

export function createClient(env: Pick<Env, 'ARC_RPC_URL'>): PublicClient {
  return createPublicClient({ transport: http(env.ARC_RPC_URL, { timeout: 15_000, retryCount: 1 }) }) as PublicClient
}

const ZERO = '0x0000000000000000000000000000000000000000'

export function createChainReader(
  client: PublicClient,
  env: Pick<Env, 'CHAINPE_ACCOUNTS_ADDRESS' | 'ERC8004_IDENTITY_REGISTRY'>
): ChainReader {
  const accounts = env.CHAINPE_ACCOUNTS_ADDRESS as `0x${string}`
  return {
    async getProvider(address) {
      const [exists, agentId, createdAt, paidUntil] = await client.readContract({
        address: accounts,
        abi: chainPeAccountsAbi,
        functionName: 'providers',
        args: [address],
      })
      return { exists, agentId, createdAt: BigInt(createdAt), paidUntil: BigInt(paidUntil) }
    },
    async planOf(address) {
      return Number(
        await client.readContract({ address: accounts, abi: chainPeAccountsAbi, functionName: 'planOf', args: [address] })
      )
    },
    async ownerOf(agentId) {
      try {
        const owner = await client.readContract({
          address: env.ERC8004_IDENTITY_REGISTRY as `0x${string}`,
          abi: OWNER_ABI,
          functionName: 'ownerOf',
          args: [agentId],
        })
        return owner.toLowerCase()
      } catch (err) {
        if (isRevert(err)) return null
        throw err
      }
    },
    async serviceProvider(key) {
      try {
        const service = await client.readContract({
          address: accounts,
          abi: chainPeAccountsAbi,
          functionName: 'getService',
          args: [key],
        })
        const provider = service.provider.toLowerCase()
        return provider === ZERO ? null : provider
      } catch (err) {
        // An unknown key reverts. That is an answer, not an outage.
        if (isRevert(err)) return null
        throw err
      }
    },
    verifySiwe({ message, signature, domain, nonce, address, time }) {
      return client.verifySiweMessage({ message, signature, domain, nonce, address, time })
    },
  }
}

const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
])
const FEES_ABI = parseAbi([
  'function batchCollected(bytes32 batchId) view returns (bool)',
  'function collect(address provider, uint256 revenueAtomic, uint256 feeAtomic, bytes32 batchId)',
])
/** The USDC ERC-20 interface on Arc: 6 decimals. */
const USDC = '0x3600000000000000000000000000000000000000'

export interface FeeCollection {
  provider: `0x${string}`
  revenueAtomic: bigint
  feeAtomic: bigint
  batchId: `0x${string}`
}

export interface FeeChain {
  allowance(provider: `0x${string}`): Promise<bigint>
  balance(provider: `0x${string}`): Promise<bigint>
  batchCollected(batchId: `0x${string}`): Promise<boolean>
  /** True when this service holds the collector key. Without it, fees are recorded and nothing is collected. */
  canCollect: boolean
  collect(collection: FeeCollection): Promise<`0x${string}`>
  receiptStatus(hash: `0x${string}`): Promise<'success' | 'reverted'>
}

export function createFeeChain(client: PublicClient, env: Pick<Env, 'ARC_RPC_URL' | 'CHAIN_ID'> & { FEES_ADDRESS: string; FEE_COLLECTOR_PRIVATE_KEY?: string }): FeeChain {
  const fees = env.FEES_ADDRESS as `0x${string}`
  const key = env.FEE_COLLECTOR_PRIVATE_KEY as `0x${string}` | undefined
  const chain = defineChain({
    id: env.CHAIN_ID,
    name: 'Arc',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [env.ARC_RPC_URL] } },
  })
  const wallet = key
    ? createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(env.ARC_RPC_URL, { timeout: 15_000, retryCount: 1 }) })
    : null
  return {
    canCollect: wallet !== null,
    allowance: (provider) => client.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'allowance', args: [provider, fees] }),
    balance: (provider) => client.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [provider] }),
    batchCollected: (batchId) => client.readContract({ address: fees, abi: FEES_ABI, functionName: 'batchCollected', args: [batchId] }),
    async collect({ provider, revenueAtomic, feeAtomic, batchId }) {
      if (!wallet) throw new Error('No collector key is configured.')
      return wallet.writeContract({
        address: fees,
        abi: FEES_ABI,
        functionName: 'collect',
        args: [provider, revenueAtomic, feeAtomic, batchId],
      })
    },
    async receiptStatus(hash) {
      return (await client.waitForTransactionReceipt({ hash })).status
    },
  }
}

/** A call the chain answered by reverting. A network failure or a 429 is not one, and must keep throwing. */
export function isRevert(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError
}
