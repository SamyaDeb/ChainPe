/**
 * Payments read straight from the chain.
 *
 * The Avalanche CLI proxy does not report telemetry, so on Avalanche a USDC transfer is the
 * payment record. An x402 "exact" payment is one transferWithAuthorization from the buyer to
 * the service's payTo for exactly the listed price, so a transfer counts as a payment when:
 *
 *   - it lands on the payTo of a registered service that was active when the chunk was indexed,
 *   - and its amount equals that service's price, to the atomic unit.
 *
 * Anything else that reaches a payTo (an exchange withdrawal, a tip, a refund) is left out and
 * shows as unattributed inflow. The event is verified by construction, since the transfer is the
 * source record, and it claims that transfer: a proxy event that reports the same payment later
 * takes the claim over in the reconciler, bringing the route and latency with it.
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { Db, Tx } from '../db.js'
import { myWallets, paymentEvents, services } from '../schema.js'
import { priceToAtomic } from '../util.js'
import type { TransferRow } from './indexer.js'

/** Prefix of a payment event the indexer made from a transfer, as opposed to one a proxy reported. */
export const ONCHAIN_ID_PREFIX = 'onchain_'

export const onchainEventId = (txHash: string, logIndex: number): string => `${ONCHAIN_ID_PREFIX}${txHash.slice(2)}_${logIndex}`

export async function derivePayments(db: Db | Tx, transfers: TransferRow[], caip2: string): Promise<number> {
  const priced = transfers.filter((t) => t.amountAtomic !== null)
  if (priced.length === 0) return 0

  const payees = [...new Set(priced.map((t) => t.to))]
  const candidates = await db
    .select({ key: services.key, provider: services.provider, name: services.name, price: services.price, payTo: services.payTo, createdBlock: services.createdBlock })
    .from(services)
    .where(and(inArray(services.payTo, payees), eq(services.active, true)))
    .orderBy(services.createdBlock, services.key)

  const providers = [...new Set(candidates.map((c) => c.provider))]
  const wallets = providers.length
    ? await db.select().from(myWallets).where(inArray(myWallets.provider, providers))
    : []
  const own = new Map<string, Set<string>>(providers.map((p) => [p, new Set([p])]))
  for (const w of wallets) own.get(w.provider)?.add(w.address)

  const rows = []
  for (const t of priced) {
    // The oldest matching service wins, so the same transfer always lands on the same one.
    const service = candidates.find((c) => c.payTo === t.to && priceToAtomic(c.price) === t.amountAtomic)
    if (!service) continue
    rows.push({
      provider: service.provider,
      id: onchainEventId(t.txHash, t.logIndex),
      serviceKey: service.key,
      ts: t.blockTs,
      effectiveTs: t.blockTs,
      route: service.name,
      method: 'x402',
      rail: 'exact' as const,
      network: caip2,
      amountAtomic: t.amountAtomic!,
      payer: t.from,
      payTo: t.to,
      txHash: t.txHash,
      paymentId: null,
      status: 'completed' as const,
      latencyMs: 0,
      backendStatus: null,
      error: null,
      verification: 'verified' as const,
      verificationReason: null,
      matchedTransfer: `exact:${t.txHash}:${t.logIndex}`,
      selfPay: own.get(service.provider)?.has(t.from) ?? false,
    })
  }
  if (rows.length === 0) return 0
  // A transfer a proxy event already claimed stays with that event.
  const inserted = await db.insert(paymentEvents).values(rows).onConflictDoNothing().returning({ id: paymentEvents.id })
  return inserted.length
}
