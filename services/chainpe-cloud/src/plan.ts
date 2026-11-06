/**
 * Plan and identity lookups, cached 60 s. An RPC failure must neither downgrade a
 * paying provider nor show someone else's reputation, so each has its own fallback.
 */
import { eq } from 'drizzle-orm'
import type { ChainReader } from './chain.js'
import type { Db } from './db.js'
import { providers } from './schema.js'

const TTL_MS = 60_000

export type Plan = 'free' | 'pro'
export type AgentIdStatus = 'owned' | 'not_owner' | 'none' | 'unknown'

export interface ProviderView {
  plan: Plan
  paidUntil: Date | null
  createdAt: Date | null
  agentId: string | null
  agentIdStatus: AgentIdStatus
}

export interface ProviderViews {
  get(address: string): Promise<ProviderView>
  invalidate(address: string): void
}

export function createProviderViews(db: Db, chain: ChainReader, now: () => number = Date.now): ProviderViews {
  const cache = new Map<string, { at: number; view: ProviderView }>()

  async function fromChain(address: string): Promise<ProviderView> {
    const account = address as `0x${string}`
    const [provider, plan] = await Promise.all([chain.getProvider(account), chain.planOf(account)])
    const agentId = provider.agentId === 0n ? null : provider.agentId
    return {
      plan: plan === 1 ? 'pro' : 'free',
      paidUntil: provider.paidUntil === 0n ? null : new Date(Number(provider.paidUntil) * 1000),
      createdAt: provider.createdAt === 0n ? null : new Date(Number(provider.createdAt) * 1000),
      agentId: agentId === null ? null : agentId.toString(),
      agentIdStatus: agentId === null ? 'none' : await ownership(address, agentId),
    }
  }

  async function ownership(address: string, agentId: bigint): Promise<AgentIdStatus> {
    try {
      return (await chain.ownerOf(agentId)) === address ? 'owned' : 'not_owner'
    } catch {
      return 'unknown'
    }
  }

  /** The indexed row decides the plan. Identity stays unknown, because ownership cannot be confirmed. */
  async function fromIndex(address: string): Promise<ProviderView> {
    const [row] = await db.select().from(providers).where(eq(providers.address, address))
    return {
      plan: row?.paidUntil && row.paidUntil.getTime() > now() ? 'pro' : 'free',
      paidUntil: row?.paidUntil ?? null,
      createdAt: row?.createdAt ?? null,
      agentId: row?.agentId ?? null,
      agentIdStatus: row?.agentId ? 'unknown' : 'none',
    }
  }

  return {
    async get(address) {
      const hit = cache.get(address)
      if (hit && now() - hit.at < TTL_MS) return hit.view
      try {
        const view = await fromChain(address)
        cache.set(address, { at: now(), view })
        return view
      } catch {
        return fromIndex(address)
      }
    },
    invalidate(address) {
      cache.delete(address)
    },
  }
}
