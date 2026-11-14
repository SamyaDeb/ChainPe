/**
 * Everything the API reads from Avalanche, behind one interface so tests can stand in
 * for the RPC. Failures throw: a caller must never read one as "not registered".
 */
import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi, type PublicClient } from 'viem'
import type { Env } from './config.js'
import { MAX_SERVICES_PER_PAGE, registryAbi } from './registryAbi.js'

const OWNER_ABI = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)'])

/** The registry scan stops here. Past it, sign-in waits for the indexer instead. */
const MAX_SCAN_PAGES = 20n

export interface ProviderOnChain {
  exists: boolean
  /** The newest nonzero ERC-8004 agent id on any of the provider's services, or 0. */
  agentId: bigint
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
  /**
   * A provider is any wallet that registered a service in ChainPeRegistry. Avalanche has no
   * account contract, so this pages through the registry. Callers ask the index first.
   */
  findProvider(address: `0x${string}`): Promise<ProviderOnChain>
  /** Null when the token does not exist or the call reverts; throws when the RPC is unreachable. */
  ownerOf(agentId: bigint): Promise<string | null>
  /** The developer of a service key, or null if the key is unknown. */
  serviceProvider(key: `0x${string}`): Promise<string | null>
  /** ecrecover for an EOA, ERC-1271 for a smart account. False for a bad signature; throws when the RPC is unreachable. */
  verifySiwe(check: SiweCheck): Promise<boolean>
}

export function createClient(env: Pick<Env, 'AVALANCHE_RPC_URL'>): PublicClient {
  return createPublicClient({ transport: http(env.AVALANCHE_RPC_URL, { timeout: 15_000, retryCount: 1 }) }) as PublicClient
}

export function createChainReader(
  client: PublicClient,
  env: Pick<Env, 'CHAINPE_REGISTRY_ADDRESS' | 'ERC8004_IDENTITY_REGISTRY'>
): ChainReader {
  const registry = env.CHAINPE_REGISTRY_ADDRESS as `0x${string}`
  return {
    async findProvider(address) {
      const wanted = address.toLowerCase()
      const count = await client.readContract({ address: registry, abi: registryAbi, functionName: 'getServiceCount' })
      let found = false
      let agentId = 0n
      let newest = 0n
      for (let page = 0n; page < MAX_SCAN_PAGES && page * MAX_SERVICES_PER_PAGE < count; page++) {
        const services = await client.readContract({
          address: registry,
          abi: registryAbi,
          functionName: 'getServices',
          args: [page * MAX_SERVICES_PER_PAGE, MAX_SERVICES_PER_PAGE],
        })
        for (const s of services) {
          if (s.developer.toLowerCase() !== wanted) continue
          found = true
          if (s.agentId !== 0n && s.updatedAt >= newest) {
            agentId = s.agentId
            newest = s.updatedAt
          }
        }
      }
      return { exists: found, agentId }
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
        const service = await client.readContract({ address: registry, abi: registryAbi, functionName: 'getServiceByKey', args: [key] })
        return service.exists ? service.developer.toLowerCase() : null
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

/** A call the chain answered by reverting. A network failure or a 429 is not one, and must keep throwing. */
export function isRevert(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError
}
