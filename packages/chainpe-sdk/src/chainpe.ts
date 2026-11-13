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
import { ChainPePaymentError } from './types.js'

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
  /** ChainPe extension (3b): the provider's ERC-8004 agent id. */
  agentId?: string
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
  /** Provider's ERC-8004 agent id, advertised on the 402 (3b). */
  agentId?: string
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
  }

  /** Echoes the resolved configuration (no secrets). */
  get config() {
    return {
      network: this.network,
      address: this.account,
      registryAddress: this.registryAddress,
      reputationRegistry: this.reputationRegistry,
      facilitatorUrl: this.facilitatorUrl,
      maxPerCall: formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)
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
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      await this.tryAutoFeedback(url, result.payTo, result.agentId)
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
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      reputation = await this.tryAutoFeedback(url, result.payTo, result.agentId)
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

    const ranked: RankedService[] = await Promise.all(
      services.map(async s => ({
        ...s,
        reputation: s.agentId
          ? await getReputation(
              this.network,
              this.reputationRegistry,
              s.agentId
            )
          : null
      }))
    )
    return rankByReputation(ranked)
  }

  /** Reads a provider agent's aggregate ERC-8004 reputation. */
  async getReputation(agentId: string): Promise<ReputationSummary | null> {
    return getReputation(this.network, this.reputationRegistry, agentId)
  }

  /** Posts ERC-8004 feedback (0–100) for a provider agent. Returns the tx hash. */
  async giveFeedback(
    agentId: string,
    score: number,
    opts: { endpoint?: string; tag?: string; waitConfirm?: boolean } = {}
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

    // 3b: prefer the provider-advertised agent id (header → body → offer extra)
    // so feedback skips the registry scan.
    const advertisedAgentId =
      initial.headers.get('x-chainpe-agent-id') ??
      body.agentId ??
      (accept.extra?.agentId as string | undefined)

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
        payTo: accept.payTo,
        agentId: advertisedAgentId
      },
      autoFeedback
    }
  }

  /**
   * Best-effort positive feedback for the provider's agent after a paid call.
   * Prefers the agent id advertised on the 402 (3b); otherwise resolves it by
   * matching `payTo` (then URL prefix) against the registry. Never throws
   * (self-feedback, no agentId, etc. are swallowed).
   */
  private async tryAutoFeedback(
    url: string,
    payTo?: string,
    advertisedAgentId?: string
  ): Promise<{ agentId: string; score: number; txHash: string } | undefined> {
    try {
      if (!this.reputationRegistry) return undefined

      let agentId = advertisedAgentId
      let endpoint: string | undefined

      // No advertised id → fall back to a registry scan by payTo / URL.
      if (!agentId || agentId === '0') {
        const registry = new RegistryClient(this.network, this.registryAddress)
        const services = await registry.listAllServices()
        const svc =
          (payTo &&
            services.find(
              s =>
                s.walletAddress.toLowerCase() === payTo.toLowerCase() &&
                s.agentId
            )) ||
          services.find(s => url.startsWith(s.endpoint) && s.agentId)
        agentId = svc?.agentId
        endpoint = svc?.endpoint
      }

      if (!agentId || agentId === '0') return undefined
      const txHash = await giveFeedback(
        this.network,
        this.reputationRegistry,
        this.privateKey,
        {
          agentId,
          value: 100,
          endpoint: endpoint ?? new URL(url).origin,
          tag: 'x402-success'
        }
      )
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
