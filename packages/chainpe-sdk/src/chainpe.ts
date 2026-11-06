/**
 * ChainPe — x402 payments on Arc, service discovery and ERC-8004 reputation.
 *
 *   const cp = new ChainPe({ privateKey })
 *   const res = await cp.fetch('https://api.example.com/paid')   // auto-pays a 402
 *   const data = await res.json()
 */
import { erc20Abi, formatUnits, parseUnits, getAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import {
  decodePaymentResponseHeader,
  wrapFetchWithPaymentFromConfig,
  type PaymentPolicy
} from '@x402/fetch'
import { isBatchPayment } from '@circle-fin/x402-batching'
import {
  BatchEvmScheme,
  CompositeEvmScheme,
  GatewayClient
} from '@circle-fin/x402-batching/client'
import {
  assertNetwork,
  getCaip2,
  getGatewayChain,
  getUsdcAddress,
  normalizeKey,
  publicClientFor,
  resolveAccountsAddress,
  resolveReputationRegistry,
  rpcUrlFor,
  USDC_DECIMALS
} from './networks.js'
import { discoverServices } from './discovery.js'
import { RegistryClient } from './registry.js'
import { getReputation, giveFeedback } from './reputation.js'
import type {
  Balances,
  ChainPeNetwork,
  ChainPeOptions,
  DiscoverOptions,
  FetchOptions,
  PaidResponse,
  PaidResult,
  PaymentInfo,
  PaymentRail,
  RankedService,
  ReputationSummary
} from './types.js'
import { ChainPePaymentError } from './types.js'

const DEFAULT_RAILS: PaymentRail[] = ['gateway', 'exact']
const AGENT_ID_HEADER = 'x-chainpe-agent-id'
const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const DEFAULT_TIMEOUT_MS = 30_000

type Requirement = Parameters<PaymentPolicy>[1][number]

/**
 * Keeps the options of the first usable rail. Gateway only counts when the
 * deposit covers the price, so a wallet with no deposit falls back to `exact`.
 */
export function railPolicy(
  rails: PaymentRail[],
  gatewayAvailable: bigint
): PaymentPolicy {
  return (_version, requirements) => {
    for (const rail of rails) {
      const options =
        rail === 'gateway'
          ? requirements.filter(
              r => isBatchPayment(r) && BigInt(r.amount) <= gatewayAvailable
            )
          : requirements.filter(r => !isBatchPayment(r))
      if (options.length > 0) return options
    }
    return []
  }
}

export class ChainPe {
  readonly network: ChainPeNetwork
  readonly rails: PaymentRail[]
  readonly accountsAddress?: `0x${string}`
  readonly reputationRegistry: `0x${string}`

  private readonly privateKey: `0x${string}`
  private readonly account: Address
  private readonly maxPerCallAtomic: bigint
  private readonly autoFeedback: boolean
  private gatewayClient?: GatewayClient

  constructor(options: ChainPeOptions) {
    if (!options.privateKey) {
      throw new Error('ChainPe: `privateKey` is required.')
    }
    this.privateKey = normalizeKey(options.privateKey)
    this.network = assertNetwork(options.network ?? 'arc-testnet')
    this.rails = options.rails?.length ? options.rails : DEFAULT_RAILS
    for (const rail of this.rails) {
      if (rail !== 'gateway' && rail !== 'exact') {
        throw new Error(`Invalid rail "${String(rail)}" (expected gateway or exact).`)
      }
    }
    this.accountsAddress = resolveAccountsAddress(this.network, options.accountsAddress)
    this.reputationRegistry = resolveReputationRegistry(
      this.network,
      options.reputationRegistry
    )
    this.account = privateKeyToAccount(this.privateKey).address
    this.maxPerCallAtomic = parseUnits(options.maxPerCall ?? '1', USDC_DECIMALS)
    this.autoFeedback = options.autoFeedback ?? false
  }

  /** Echoes the resolved configuration (no secrets). */
  get config() {
    return {
      network: this.network,
      address: this.account,
      rails: this.rails,
      accountsAddress: this.accountsAddress,
      reputationRegistry: this.reputationRegistry,
      maxPerCall: formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)
    }
  }

  /** The wallet address that signs payments and feedback. */
  getAddress(): string {
    return this.account
  }

  /** Reads the wallet's USDC and the Circle Gateway deposit (human units). */
  async balance(): Promise<Balances> {
    const usdc = (await publicClientFor(this.network).readContract({
      address: getUsdcAddress(this.network),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(this.account)]
    })) as bigint
    return {
      usdc: formatUnits(usdc, USDC_DECIMALS),
      gateway: formatUnits(await this.gatewayAvailable(), USDC_DECIMALS)
    }
  }

  /** Deposits USDC into Circle Gateway, to pay on the Gateway rail with no gas. */
  async depositGateway(amount: string): Promise<{ txHash: string; amount: string }> {
    if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, USDC_DECIMALS) <= 0n) {
      throw new Error(`Invalid amount "${amount}" (expected positive USDC, e.g. 1.50).`)
    }
    const result = await this.gateway().deposit(amount)
    return { txHash: result.depositTxHash, amount: result.formattedAmount }
  }

  /**
   * Drop-in `fetch` that automatically pays an x402 `402 Payment Required` in
   * USDC and returns the final live {@link Response}.
   */
  async fetch(url: string, opts: FetchOptions = {}): Promise<Response> {
    const { result, autoFeedback } = await this.execute(url, opts)
    if (result.payment && (autoFeedback ?? this.autoFeedback)) {
      await this.tryAutoFeedback(url, result.payment.recipient, result.agentId)
    }
    return result.response
  }

  /**
   * Like {@link fetch}, but returns the live, unread {@link Response} together
   * with the payment details. Never posts feedback.
   */
  async request(url: string, opts: FetchOptions = {}): Promise<PaidResponse> {
    return (await this.execute(url, opts)).result
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
      reputation = await this.tryAutoFeedback(
        url,
        result.payment.recipient,
        result.agentId
      )
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
   * Finds services through Circle's Discovery API and ChainPeAccounts, annotated
   * with ERC-8004 reputation and ranked. ChainPeAccounts also covers providers
   * Circle has not listed yet. Throws only when neither source can be read.
   */
  async discover(
    query: string | DiscoverOptions = {}
  ): Promise<RankedService[]> {
    return discoverServices(this.network, query, {
      accountsAddress: this.accountsAddress,
      reputationRegistry: this.reputationRegistry
    })
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
    return giveFeedback(this.network, this.reputationRegistry, this.privateKey, {
      agentId,
      value: score,
      ...opts
    })
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private gateway(): GatewayClient {
    this.gatewayClient ??= new GatewayClient({
      chain: getGatewayChain(this.network),
      privateKey: this.privateKey,
      rpcUrl: rpcUrlFor(this.network)
    })
    return this.gatewayClient
  }

  /** A deposit we cannot read counts as empty, so payment falls back to the wallet. */
  private async gatewayAvailable(): Promise<bigint> {
    try {
      return (await this.gateway().getBalances()).gateway.available
    } catch {
      return 0n
    }
  }

  /**
   * Runs the x402 flow: request → on 402, cap the price, choose a rail, sign →
   * retry. Spend limits run before anything is signed.
   */
  private async execute(
    url: string,
    opts: FetchOptions
  ): Promise<{ result: PaidResponse; autoFeedback?: boolean }> {
    const { autoFeedback, timeout = DEFAULT_TIMEOUT_MS, ...init } = opts

    let selected: Requirement | undefined
    let agentId: string | undefined
    let gatewayAvailable = 0n

    const baseFetch: typeof fetch = async (input, requestInit) => {
      const caller = requestInit?.signal ?? (input instanceof Request ? input.signal : undefined)
      const expiry = AbortSignal.timeout(timeout)
      const response = await fetch(input, {
        ...requestInit,
        signal: caller ? AbortSignal.any([caller, expiry]) : expiry
      })
      agentId = response.headers.get(AGENT_ID_HEADER) ?? agentId
      // Only a request that has to pay spends a call on reading the deposit.
      if (
        response.status === 402 &&
        !selected &&
        this.rails.includes('gateway')
      ) {
        gatewayAvailable = await this.gatewayAvailable()
      }
      return response
    }

    const account = privateKeyToAccount(this.privateKey)
    const client = new CompositeEvmScheme(
      new BatchEvmScheme(account),
      new ExactEvmScheme(account)
    )
    const caip2 = getCaip2(this.network) as `${string}:${string}`
    const payingFetch = wrapFetchWithPaymentFromConfig(baseFetch, {
      schemes: [{ network: caip2, client: client as unknown as ExactEvmScheme }],
      // CompositeEvmScheme cannot name default assets, so Arc USDC is listed with its own cap.
      spendControls: {
        maxAmountPerPayment: false as const,
        allowedAssets: [
          {
            network: caip2,
            asset: getUsdcAddress(this.network),
            maxAmountPerPayment: this.maxPerCallAtomic.toString()
          }
        ]
      },
      policies: [
        (version, requirements) => {
          const options = railPolicy(this.rails, gatewayAvailable)(version, requirements)
          selected = options[0]
          return options
        }
      ]
    })

    let response: Response
    try {
      response = await payingFetch(url, init)
    } catch (err) {
      throw this.explainPaymentError(err, url)
    }

    if (response.status === 402) {
      const reason = await readFailureReason(response)
      throw new ChainPePaymentError(
        `x402: payment signed but the server did not accept it (${reason}). ` +
          `Check the USDC on ${this.network} or the Gateway deposit.`,
        { reason }
      )
    }
    return {
      result: {
        response,
        payment: selected ? this.paymentInfo(selected, response) : undefined,
        agentId
      },
      autoFeedback
    }
  }

  private paymentInfo(selected: Requirement, response: Response): PaymentInfo {
    const payment: PaymentInfo = {
      amount: formatUnits(BigInt(selected.amount), USDC_DECIMALS),
      recipient: selected.payTo,
      network: this.network,
      rail: isBatchPayment(selected) ? 'gateway' : 'exact'
    }
    const header = response.headers.get('PAYMENT-RESPONSE')
    if (header) {
      try {
        const receipt = decodePaymentResponseHeader(header)
        payment.settlement = receipt
        if (TX_HASH.test(receipt.transaction)) payment.txHash = receipt.transaction
        else if (receipt.transaction) payment.transferId = receipt.transaction
      } catch {
        /* Keep what is known without the receipt. */
      }
    }
    return payment
  }

  private explainPaymentError(err: unknown, url: string): unknown {
    const message = err instanceof Error ? err.message : String(err)
    if (/no network\/scheme registered/i.test(message)) {
      return new Error(`x402: ${url} does not accept payment on ${this.network}.`)
    }
    if (/spend|maxAmountPerPayment|allowedAssets|exceed/i.test(message)) {
      return new Error(
        `x402: the price for ${url} exceeds maxPerCall ` +
          `${formatUnits(this.maxPerCallAtomic, USDC_DECIMALS)} USDC. Nothing was signed.`
      )
    }
    if (/filtered|policy|policies/i.test(message)) {
      return new ChainPePaymentError(
        `x402: ${url} has no payment option for rails [${this.rails.join(', ')}]. ` +
          'A Gateway-only price needs a Gateway deposit.',
        { reason: 'no_usable_rail' }
      )
    }
    return err
  }

  /**
   * Best-effort positive feedback for the provider's agent after a paid call.
   * Prefers the agent id the provider advertises; otherwise looks for its `payTo`
   * in ChainPeAccounts. Never throws (self-feedback, no gas, etc. are swallowed).
   */
  private async tryAutoFeedback(
    url: string,
    payTo: string,
    advertisedAgentId?: string
  ): Promise<{ agentId: string; score: number; txHash: string } | undefined> {
    try {
      let agentId = advertisedAgentId
      if ((!agentId || agentId === '0') && this.accountsAddress) {
        const registry = new RegistryClient(this.network, this.accountsAddress)
        const services = await registry.listAllServices()
        agentId = services.find(
          s => s.walletAddress.toLowerCase() === payTo.toLowerCase() && s.agentId
        )?.agentId
      }
      if (!agentId || agentId === '0') return undefined
      const txHash = await giveFeedback(
        this.network,
        this.reputationRegistry,
        this.privateKey,
        {
          agentId,
          value: 100,
          endpoint: new URL(url).origin,
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

async function readFailureReason(response: Response): Promise<string> {
  const header = response.headers.get('PAYMENT-RESPONSE')
  if (header) {
    try {
      const receipt = decodePaymentResponseHeader(header)
      if (receipt.errorReason) return receipt.errorReason
    } catch {
      /* Fall through to the body. */
    }
  }
  try {
    const body = (await response.clone().json()) as { reason?: string; error?: string }
    return body.reason ?? body.error ?? 'settlement refused'
  } catch {
    return 'settlement refused'
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}
