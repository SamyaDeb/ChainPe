/**
 * ChainPe — x402 payments + ERC-8004 reputation in a few lines.
 *
 *   const cp = new ChainPe({ privateKey, network: 'fuji' })
 *   const res = await cp.fetch('https://api.example.com/paid')   // auto-pays a 402
 *   const data = await res.json()
 */
import {
  erc20Abi,
  formatUnits,
  parseUnits,
  getAddress,
  type Address
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createSigner, decodeXPaymentResponse } from 'x402-fetch'
import { createPaymentHeader } from 'x402/client'
import type { PaymentRequirements } from 'x402/types'
import {
  publicClientFor,
  getUsdcAddress,
  getX402Network,
  resolveRegistryAddress,
  resolveReputationRegistry,
  normalizeKey,
  USDC_DECIMALS
} from './networks.js'
import {
  RegistryClient,
  filterServices,
  rankByReputation
} from './registry.js'
import { getReputation, giveFeedback } from './reputation.js'
import { CloudClient, checkMinimum, toPaidSummary } from './cloud.js'
import type {
  ChainPeNetwork,
  ChainPeOptions,
  FetchOptions,
  DiscoverOptions,
  RankedService,
  ReputationSummary,
  PaidResult,
  PaymentInfo,
  Balances
} from './types.js'
import { ChainPePaymentError, ReputationTooLow } from './types.js'

type Signer = Awaited<ReturnType<typeof createSigner>>

interface PaymentAccept {
  scheme: string
  network: string
  asset: string
  maxAmountRequired: string
  payTo: string
  resource?: string
  description?: string
  extra?: Record<string, unknown>
}

interface PaymentRequiredBody {
  x402Version: number
  error?: string
  accepts?: PaymentAccept[]
}

const X402_TO_NETWORK: Record<string, ChainPeNetwork> = {
  'avalanche-fuji': 'fuji',
  avalanche: 'avalanche'
}

/** Internal result of a paid request: a live (unconsumed) Response + metadata. */
interface PaidRequest {
  response: Response
  /** Set when a payment was actually made. */
  payment?: PaymentInfo
  /** The selected 402 offer, when payment occurred. */
  payTo?: string
}

export class ChainPe {
  readonly network: ChainPeNetwork
  readonly registryAddress: `0x${string}`
  readonly reputationRegistry?: `0x${string}`

  private readonly privateKey: string
  private readonly account: Address
  private readonly maxPerCallAtomic: bigint
  private readonly autoFeedback: boolean
  private readonly facilitatorUrl?: string
  private readonly minReputation: number
  private readonly minPaidReviews: number
  private readonly cloud: CloudClient
  private signer?: Signer

  constructor(options: ChainPeOptions) {
    if (!options.privateKey) {
      throw new Error('ChainPe: `privateKey` is required.')
    }
    this.privateKey = options.privateKey
    this.network = options.network ?? 'avalanche'
    this.registryAddress = resolveRegistryAddress(
      this.network,
      options.registryAddress
    )
    this.reputationRegistry = resolveReputationRegistry(
      this.network,
      options.reputationRegistry
    )
    this.account = privateKeyToAccount(normalizeKey(this.privateKey)).address
    this.maxPerCallAtomic = parseUnits(
      options.maxPerCall ?? '1',
      USDC_DECIMALS
    )
    this.autoFeedback = options.autoFeedback ?? false
    this.facilitatorUrl = options.facilitatorUrl
    this.minReputation = options.minReputation ?? 0
    this.minPaidReviews = options.minPaidReviews ?? 3
    if (this.minReputation < 0 || this.minReputation > 100) {
      throw new Error('ChainPe: `minReputation` must be between 0 and 100.')
    }
    this.cloud = new CloudClient({ baseUrl: options.cloudUrl })
  }

  /** Echoes the resolved configuration (no secrets). */
  get config() {
    return {
      network: this.network,
      address: this.account,
      registryAddress: this.registryAddress,
      reputationRegistry: this.reputationRegistry,
      facilitatorUrl: this.facilitatorUrl,
      maxPerCall: formatUnits(this.maxPerCallAtomic, USDC_DECIMALS),
      minReputation: this.minReputation,
      minPaidReviews: this.minPaidReviews,
      cloudUrl: this.cloud.baseUrl
    }
  }

  /** The wallet address that signs payments and feedback. */
  getAddress(): string {
    return this.account
  }

  /** Reads on-chain USDC + AVAX balances (human units). */
  async balance(): Promise<Balances> {
    const client = publicClientFor(this.network)
    const address = getAddress(this.account)
    const [usdcRaw, wei] = await Promise.all([
      client
        .readContract({
          address: getUsdcAddress(this.network),
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address]
        })
        .catch(() => 0n) as Promise<bigint>,
      client.getBalance({ address }).catch(() => 0n)
    ])
    return {
      usdc: formatUnits(usdcRaw, USDC_DECIMALS),
      avax: formatUnits(wei, 18)
    }
  }

  /**
   * Drop-in `fetch` that automatically pays an x402 `402 Payment Required`
   * (USDC via EIP-3009) and returns the final live {@link Response}.
   */
  async fetch(url: string, opts: FetchOptions = {}): Promise<Response> {
    const { result, autoFeedback } = await this.execute(url, opts)
    // Only rate a call that actually delivered: a 4xx/5xx paid response never earns a positive review.
    if (result.payment && result.response.ok && (autoFeedback ?? this.autoFeedback)) {
      await this.tryAutoFeedback(url, result.payTo, result.payment.txHash)
    }
    return result.response
  }

  /**
   * Like {@link fetch}, but returns a structured, body-parsed result with the
   * payment + (optional) reputation details. Convenient for agents.
   */
  async pay<T = unknown>(
    url: string,
    opts: FetchOptions = {}
  ): Promise<PaidResult<T>> {
    const { result, autoFeedback } = await this.execute(url, opts)
    const { response } = result

    let reputation: PaidResult<T>['reputation']
    if (result.payment && response.ok && (autoFeedback ?? this.autoFeedback)) {
      reputation = await this.tryAutoFeedback(url, result.payTo, result.payment.txHash)
    }

    const data = (await this.parseBody(response)) as T
    return {
      status: response.status,
      ok: response.ok,
      headers: headersToObject(response.headers),
      data,
      payment: result.payment,
      reputation
    }
  }

  /**
   * Discovers registered services, annotated with ERC-8004 reputation and
   * ranked (scored first, higher score first). Pass a search string or filters.
   */
  async discover(
    query: string | DiscoverOptions = {}
  ): Promise<RankedService[]> {
    const options: DiscoverOptions =
      typeof query === 'string' ? { query } : query
    const registry = new RegistryClient(this.network, this.registryAddress)
    const services = filterServices(await registry.listAllServices(), options)

    // Payment-verified scores from chainpe-cloud. If it is unreachable, fall back to the plain on-chain average and
    // say so (`source: 'unverified'`): anyone can post those ratings.
    let paid: Awaited<ReturnType<CloudClient['services']>> | undefined
    try {
      paid = await this.cloud.services()
    } catch {
      paid = undefined
    }
    const ranked: RankedService[] = await Promise.all(
      services.map(async s => {
        if (paid) {
          const hit =
            paid.find(c => c.payTo.toLowerCase() === s.walletAddress.toLowerCase() && !c.payToShared && s.endpoint === c.endpoint) ??
            paid.find(c => c.payTo.toLowerCase() === s.walletAddress.toLowerCase() && !c.payToShared)
          return { ...s, reputation: toPaidSummary(hit ?? null) }
        }
        return {
          ...s,
          reputation: s.agentId
            ? await getReputation(this.network, this.reputationRegistry, s.agentId)
            : null
        }
      })
    )
    return rankByReputation(ranked)
  }

  /**
   * Reads a provider agent's plain on-chain ERC-8004 average over every rating. Anyone can post a rating, so this is
   * labelled `source: 'unverified'`. Prefer {@link getPaidReputation}.
   */
  async getReputation(agentId: string): Promise<ReputationSummary | null> {
    return getReputation(this.network, this.reputationRegistry, agentId)
  }

  /**
   * The payment-verified reputation of whoever is paid at `payTo`: only ratings backed by a verified x402 payment,
   * weighted by USDC paid. Falls back to the on-chain average (labelled `unverified`) if chainpe-cloud is unreachable.
   */
  async getPaidReputation(payTo: string, url?: string): Promise<ReputationSummary | null> {
    try {
      return toPaidSummary(await this.cloud.serviceFor(payTo, url))
    } catch {
      const agentId = await this.resolveAgentId(payTo, url).catch(() => undefined)
      return agentId ? getReputation(this.network, this.reputationRegistry, agentId) : null
    }
  }

  /**
   * Posts ERC-8004 feedback (0–100) for a provider agent. Returns the tx hash. Pass the x402 settlement tx as
   * `paymentTx` so it counts as a paid review; without it the rating is allowed but shows as unverified.
   */
  async giveFeedback(
    agentId: string,
    score: number,
    opts: { endpoint?: string; tag?: string; paymentTx?: string; waitConfirm?: boolean } = {}
  ): Promise<string> {
    return giveFeedback(
      this.network,
      this.reputationRegistry,
      this.privateKey,
      { agentId, value: score, ...opts }
    )
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private async ensureSigner(): Promise<Signer> {
    if (!this.signer) {
      this.signer = await createSigner(
        getX402Network(this.network),
        normalizeKey(this.privateKey)
      )
    }
    return this.signer
  }

  /**
   * Runs the x402 flow manually so we can surface the payment metadata and the
   * `payTo` (needed to resolve the provider's agent for feedback): initial
   * request → on 402, select the matching offer, sign, retry with `X-PAYMENT`.
   */
  private async execute(
    url: string,
    opts: FetchOptions
  ): Promise<{ result: PaidRequest; autoFeedback?: boolean }> {
    const { autoFeedback, timeout = 30_000, ...init } = opts

    // Wraps fetch with an AbortController timeout so hung servers don't stall forever.
    const fetchWithTimeout = (input: string, options: RequestInit) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      return fetch(input, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer))
    }

    const initial = await fetchWithTimeout(url, init)
    if (initial.status !== 402) {
      return { result: { response: initial }, autoFeedback }
    }

    const body = (await initial.json()) as PaymentRequiredBody
    const accept = (body.accepts ?? []).find(
      a => X402_TO_NETWORK[a.network] === this.network
    )
    if (!accept) {
      const nets = (body.accepts ?? []).map(a => a.network).join(', ') || 'none'
      throw new Error(
        `x402: server accepts [${nets}] but wallet is on ${this.network}.`
      )
    }

    const required = BigInt(accept.maxAmountRequired)
    if (required > this.maxPerCallAtomic) {
      throw new Error(
        `x402: payment of ${formatUnits(required, USDC_DECIMALS)} USDC exceeds maxPerCall ` +
          `${formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)} USDC for ${url}.`
      )
    }

    // Before anything is signed: refuse a provider whose verified record is too weak.
    await this.enforceMinimum(accept.payTo, url)

    let header: string | null
    try {
      const signer = await this.ensureSigner()
      header = await createPaymentHeader(
        signer,
        body.x402Version,
        accept as unknown as PaymentRequirements
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new ChainPePaymentError(`x402: failed to sign payment — ${msg}`, { reason: msg })
    }
    if (!header) throw new ChainPePaymentError('x402: failed to generate payment header.')

    const retryHeaders = new Headers(init.headers)
    retryHeaders.set('X-PAYMENT', header)
    const paid = await fetchWithTimeout(url, { ...init, headers: retryHeaders })

    if (paid.status === 402) {
      throw new ChainPePaymentError(
        `x402: payment signed but the server could not settle (needs USDC on ${this.network}). ` +
          `Attempted ${formatUnits(required, USDC_DECIMALS)} USDC → ${accept.payTo}.`,
        { reason: 'settlement_rejected' }
      )
    }

    const payment: PaymentInfo = {
      amount: formatUnits(required, USDC_DECIMALS),
      recipient: accept.payTo,
      network: this.network
    }
    const settleHeader = paid.headers.get('X-PAYMENT-RESPONSE')
    if (settleHeader) {
      try {
        const decoded = decodeXPaymentResponse(settleHeader) as Record<
          string,
          unknown
        >
        payment.settlement = decoded
        payment.txHash =
          (decoded.transaction as string) ?? (decoded.txHash as string)
      } catch {
        /* keep undecoded */
      }
    }

    return {
      result: {
        response: paid,
        payment,
        payTo: accept.payTo
      },
      autoFeedback
    }
  }

  /** Throws {@link ReputationTooLow} when a minimum is set and the provider's verified record does not meet it. */
  private async enforceMinimum(payTo: string, url: string): Promise<void> {
    if (this.minReputation <= 0) return
    const base = { payTo, url, minReputation: this.minReputation, minPaidReviews: this.minPaidReviews }
    let service
    try {
      service = await this.cloud.serviceFor(payTo, url)
    } catch {
      // Cannot verify, so do not pay. An unverified on-chain average is not evidence.
      throw new ReputationTooLow({ ...base, reason: 'unavailable', paidScore: null, paidReviews: 0 })
    }
    const reason = checkMinimum(service, this.minReputation, this.minPaidReviews)
    if (reason) {
      throw new ReputationTooLow({ ...base, reason, paidScore: service?.paidScore ?? null, paidReviews: service?.paidReviews ?? 0 })
    }
  }

  /**
   * The ERC-8004 agent that owns the service paid at `payTo`, read from the on-chain registry. The earliest registrant
   * of a payTo wins, matching how chainpe-cloud credits payments. Never taken from anything the server sends: since
   * registry v2, only the agent's owner can link an agentId, so this cannot be pointed at someone else's agent.
   */
  async resolveAgentId(payTo: string, url?: string): Promise<string | undefined> {
    const registry = new RegistryClient(this.network, this.registryAddress)
    const services = (await registry.listAllServices()).filter(
      s => s.walletAddress.toLowerCase() === payTo.toLowerCase()
    )
    const svc = (url && services.find(s => url.startsWith(s.endpoint) && s.agentId)) || services.find(s => s.agentId)
    return svc?.agentId && svc.agentId !== '0' ? svc.agentId : undefined
  }

  /**
   * Best-effort positive feedback after a paid call, carrying the settlement tx as `feedbackHash` so chainpe-cloud can
   * verify the payment. Skipped when the provider reported no settlement tx (an unpaid rating would not count anyway).
   * Never throws (self-feedback, no agentId, etc. are swallowed).
   */
  private async tryAutoFeedback(
    url: string,
    payTo?: string,
    paymentTx?: string
  ): Promise<{ agentId: string; score: number; txHash: string } | undefined> {
    try {
      if (!this.reputationRegistry || !payTo || !paymentTx) return undefined
      const agentId = await this.resolveAgentId(payTo, url)
      if (!agentId) return undefined
      const u = new URL(url)
      const txHash = await giveFeedback(this.network, this.reputationRegistry, this.privateKey, {
        agentId,
        value: 100,
        // The resource, without its query string: that can carry keys.
        endpoint: `${u.origin}${u.pathname}`,
        tag: 'x402-success',
        paymentTx
      })
      return { agentId, score: 100, txHash }
    } catch {
      return undefined
    }
  }

  private async parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        return await response.json()
      } catch {
        return null
      }
    }
    return response.text()
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}
