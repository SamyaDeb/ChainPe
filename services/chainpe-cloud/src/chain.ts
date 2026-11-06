/**
 * Everything the API reads from Arc, behind one interface so tests can stand in
 * for the RPC. Failures throw: a caller must never read one as "not registered".
 */
import { createPublicClient, http, parseAbi, type PublicClient } from 'viem'
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
      const service = await client.readContract({
        address: accounts,
        abi: chainPeAccountsAbi,
        functionName: 'getService',
        args: [key],
      })
      const provider = service.provider.toLowerCase()
      return provider === ZERO ? null : provider
    },
    verifySiwe({ message, signature, domain, nonce, address, time }) {
      return client.verifySiweMessage({ message, signature, domain, nonce, address, time })
    },
  }
}

function isRevert(err: unknown): boolean {
  return err instanceof Error && err.name === 'ContractFunctionExecutionError' && /revert/i.test(err.message)
}
