/**
 * Payments read straight from the chain.
 *
 * The Avalanche CLI proxy does not report telemetry, so on Avalanche a USDC transfer is the
 * payment record. An x402 "exact" payment is one transferWithAuthorization from the buyer to
 * the service's payTo for exactly the listed price, so a transfer counts as a payment when:
 *
 *   - its tx emitted USDC `AuthorizationUsed` from the payer (an EIP-3009 payment, not a plain transfer),
 *   - it lands on the payTo of a registered service that was active when the chunk was indexed,
 *   - the payTo is attributed to its earliest registrant only (a later service that reuses the address is
 *     "shared" and earns nothing, so nobody can claim another provider's revenue by copying its payTo),
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

/** Key for the set of `AuthorizationUsed` logs seen in a chunk: the tx and the authorizer that signed. */
export const authKey = (txHash: string, authorizer: string): string => `${txHash.toLowerCase()}:${authorizer.toLowerCase()}`

/** A provider's own addresses: the registering wallet plus its declared my_wallets. Used for self-pay and self-rating. */
export async function ownWallets(db: Db | Tx, providerAddresses: string[]): Promise<Map<string, Set<string>>> {
  const own = new Map<string, Set<string>>(providerAddresses.map((p) => [p, new Set([p])]))
  if (providerAddresses.length === 0) return own
  const wallets = await db.select().from(myWallets).where(inArray(myWallets.provider, providerAddresses))
  for (const w of wallets) own.get(w.provider)?.add(w.address)
  return own
}

/**
 * @param authorizations `authKey(tx, authorizer)` for every USDC `AuthorizationUsed` log in the same block range.
 *        Read from the logs the indexer already fetches for the chunk, so this costs no call per transfer.
 */
export async function derivePayments(db: Db | Tx, transfers: TransferRow[], caip2: string, authorizations: ReadonlySet<string>): Promise<number> {
  const priced = transfers.filter((t) => t.amountAtomic !== null && authorizations.has(authKey(t.txHash, t.from)))
  if (priced.length === 0) return 0

  const payees = [...new Set(priced.map((t) => t.to))]
  const candidates = await db
    .select({ key: services.key, provider: services.provider, name: services.name, price: services.price, payTo: services.payTo, createdBlock: services.createdBlock })
    .from(services)
    .where(and(inArray(services.payTo, payees), eq(services.active, true)))
    .orderBy(services.createdBlock, services.key)

  const own = await ownWallets(db, [...new Set(candidates.map((c) => c.provider))])

  const rows = []
  for (const t of priced) {
    // Only the earliest registrant of a payTo is attributed; later services on the same address are shared and ignored.
    const service = candidates.find((c) => c.payTo === t.to)
    if (!service || priceToAtomic(service.price) !== t.amountAtomic) continue
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
