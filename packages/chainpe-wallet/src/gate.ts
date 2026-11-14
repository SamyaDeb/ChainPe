/**
 * Reputation gate for payments. Runs BEFORE a payment is signed: if MIN_REPUTATION is set and the provider's
 * payment-verified score (chainpe-cloud) is below it, the call is refused and nothing is signed.
 */
import type { AppConfig } from '@/types.js'
import { CloudClient, checkMinimum, type CloudService, type RefusalReason } from '@/cloud.js'

const clients = new Map<string, CloudClient>()

/** One CloudClient per URL, so its short cache is shared across tool calls. */
export function cloudFor(config: Pick<AppConfig, 'cloudUrl'>): CloudClient {
  const id = String(config.cloudUrl ?? 'default')
  let c = clients.get(id)
  if (!c) {
    c = new CloudClient({ baseUrl: config.cloudUrl })
    clients.set(id, c)
  }
  return c
}

/** Drops cached clients (and their cached service lists). For tests. */
export function resetCloudCache(): void {
  clients.clear()
}

export interface Refusal {
  reason: RefusalReason
  paidScore: number | null
  paidReviews: number
  /** A message written for an LLM to relay to the user. */
  message: string
}

/** Null when payment may proceed. */
export async function reputationRefusal(
  config: Pick<AppConfig, 'minReputation' | 'minPaidReviews' | 'cloudUrl'>,
  payTo: string,
  url: string
): Promise<Refusal | null> {
  if (!(config.minReputation > 0)) return null
  let service: CloudService | null
  try {
    service = await cloudFor(config).serviceFor(payTo, url)
  } catch {
    return refusal('unavailable', null, 0, config, payTo, url)
  }
  const reason = checkMinimum(service, config.minReputation, config.minPaidReviews)
  return reason ? refusal(reason, service?.paidScore ?? null, service?.paidReviews ?? 0, config, payTo, url) : null
}

function refusal(
  reason: RefusalReason,
  paidScore: number | null,
  paidReviews: number,
  config: Pick<AppConfig, 'minReputation' | 'minPaidReviews'>,
  payTo: string,
  url: string
): Refusal {
  const why: Record<RefusalReason, string> = {
    unavailable: 'its payment-verified reputation could not be checked right now (the reputation service is unreachable)',
    unknown_service: 'it is not a service registered in the ChainPe registry, so it has no verified record',
    not_enough_reviews: `it has only ${paidReviews} verified paid review(s); at least ${config.minPaidReviews} are required`,
    below_minimum: `its payment-verified score is ${paidScore}/100 (from ${paidReviews} paid reviews), below the minimum of ${config.minReputation}`
  }
  return {
    reason,
    paidScore,
    paidReviews,
    message:
      `REFUSED, nothing was signed and no money moved. ${url} (pays ${payTo}) was not paid because ${why[reason]}. ` +
      `This is the MIN_REPUTATION=${config.minReputation} safety setting. Do not retry this service; tell the user, ` +
      'and use search_bazaar to choose a provider at or above the minimum.'
  }
}
