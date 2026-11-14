/**
 * Plan and identity lookups, cached 60 s.
 *
 * Avalanche has no paid plan: there is no account contract to subscribe on, so every provider
 * gets the full view. The API still reports it as plan "pro", which keeps the Arc-era limits
 * (7-day window, one service, five buyers) switched off without forking the route code.
 *
 * The agent id is the newest nonzero one on the provider's services, from the index. An RPC
 * failure on the ownership check must not show someone else's reputation, so it reads as unknown.
 */
import { eq } from 'drizzle-orm'
import type { ChainReader } from './chain.js'
import type { Db } from './db.js'
import { providers } from './schema.js'

const TTL_MS = 60_000

export type Plan = 'free' | 'pro'
export type AgentIdStatus = 'owned' | 'not_owner' | 'none' | 'unknown'

export const AVALANCHE_PLAN: Plan = 'pro'

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

  async function ownership(address: string, agentId: string): Promise<AgentIdStatus> {
    try {
      return (await chain.ownerOf(BigInt(agentId))) === address ? 'owned' : 'not_owner'
    } catch {
      return 'unknown'
    }
  }

  return {
    async get(address) {
      const hit = cache.get(address)
      if (hit && now() - hit.at < TTL_MS) return hit.view
      const [row] = await db.select().from(providers).where(eq(providers.address, address))
      const agentId = row?.agentId ?? null
      const status = agentId === null ? 'none' : await ownership(address, agentId)
      const view: ProviderView = {
        plan: AVALANCHE_PLAN,
        paidUntil: null,
        createdAt: row?.createdAt ?? null,
        agentId,
        agentIdStatus: status,
      }
      // An unknown answer is not cached, so the next read tries the chain again.
      if (status !== 'unknown') cache.set(address, { at: now(), view })
      return view
    },
    invalidate(address) {
      cache.delete(address)
    },
  }
}
