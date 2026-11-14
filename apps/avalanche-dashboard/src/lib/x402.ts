/**
 * x402 v1 "exact" payments on Avalanche, for the Explore page's "Try it". Pure functions only: the modal does the
 * wallet calls and the fetches, and everything it signs or sends is built and checked here (tests:
 * scripts/test-x402.ts).
 *
 * The payment header mirrors what packages/chainpe-sdk sends (it calls x402's createPaymentHeader):
 *   base64(JSON { x402Version, scheme, network, payload: { signature, authorization: { from, to, value, validAfter,
 *   validBefore, nonce } } }), every authorization number a decimal string, signed as EIP-3009
 *   TransferWithAuthorization over the USDC domain { name: extra.name, version: extra.version, chainId, verifyingContract }.
 */
import { getAddress, isAddress, toHex, type Address, type Hex } from 'viem'

export const AVALANCHE_CHAIN_ID = 43114
/** x402's name for Avalanche C-Chain mainnet. */
export const X402_NETWORK = 'avalanche'
/** Native Circle USDC on Avalanche C-Chain, 6 decimals. */
export const USDC_ADDRESS: Address = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
/** ERC-8004 ReputationRegistry on Avalanche mainnet. */
export const REPUTATION_REGISTRY: Address = '0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543'
/** Longest authorization we sign: an x402 server asking for more is refused. */
export const MAX_TIMEOUT_SECONDS = 300
/** validAfter is set this far in the past, so a wallet clock slightly ahead of the chain still settles. */
export const VALID_AFTER_SKEW_SECONDS = 60

export class X402Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'X402Error'
  }
}

export interface PaymentRequirements {
  scheme: string
  network: string
  maxAmountRequired: string
  resource?: string
  description?: string
  mimeType?: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra?: { name?: unknown; version?: unknown } & Record<string, unknown>
}

export interface PaymentRequired {
  x402Version: number
  error?: string
  accepts: PaymentRequirements[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The body of a 402. Throws X402Error when it is not an x402 v1 answer. */
export function parsePaymentRequired(body: unknown): PaymentRequired {
  if (!isObject(body)) throw new X402Error('The 402 answer is not a JSON object.')
  if (body.x402Version !== 1) throw new X402Error(`Unsupported x402 version ${JSON.stringify(body.x402Version)}. This page speaks x402 v1.`)
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) throw new X402Error('The 402 answer lists no payment options.')
  const accepts: PaymentRequirements[] = []
  for (const a of body.accepts) {
    if (!isObject(a)) continue
    accepts.push({
      scheme: str(a.scheme),
      network: str(a.network),
      maxAmountRequired: str(a.maxAmountRequired),
      resource: typeof a.resource === 'string' ? a.resource : undefined,
      description: typeof a.description === 'string' ? a.description : undefined,
      mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
      payTo: str(a.payTo),
      maxTimeoutSeconds: typeof a.maxTimeoutSeconds === 'number' ? a.maxTimeoutSeconds : Number.NaN,
      asset: str(a.asset),
      extra: isObject(a.extra) ? a.extra : undefined,
    })
  }
  if (accepts.length === 0) throw new X402Error('The 402 answer lists no readable payment options.')
  return { x402Version: 1, error: typeof body.error === 'string' ? body.error : undefined, accepts }
}

export interface Expected {
  /** The service's payTo from the ChainPe registry. */
  payTo: string
  /** The listed price, atomic USDC. */
  priceAtomic: string
}

/** An offer that passed every check, with the USDC EIP-712 domain present. */
export type ValidRequirements = PaymentRequirements & { extra: { name: string; version: string } }

export type Selection = { ok: true; requirements: ValidRequirements } | { ok: false; problems: string[] }

const eqAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** What is wrong with one offer, checked before anything is signed. Empty means it is safe to sign. */
export function problemsWith(a: PaymentRequirements, expected: Expected): string[] {
  const problems: string[] = []
  if (a.network !== X402_NETWORK) problems.push(`Network is "${a.network}", not Avalanche mainnet ("${X402_NETWORK}").`)
  if (a.scheme !== 'exact') problems.push(`Scheme is "${a.scheme}", not "exact".`)
  if (!isAddress(a.asset, { strict: false }) || !eqAddress(a.asset, USDC_ADDRESS)) problems.push(`Asset ${a.asset || '(none)'} is not native USDC (${USDC_ADDRESS}).`)
  if (!isAddress(a.payTo, { strict: false })) problems.push(`payTo ${a.payTo || '(none)'} is not an address.`)
  else if (!eqAddress(a.payTo, expected.payTo)) problems.push(`payTo ${a.payTo} is not this service's registered payTo (${expected.payTo}).`)
  if (!/^\d+$/.test(a.maxAmountRequired)) problems.push(`Amount "${a.maxAmountRequired}" is not an atomic USDC amount.`)
  else if (!/^\d+$/.test(expected.priceAtomic) || BigInt(a.maxAmountRequired) !== BigInt(expected.priceAtomic)) {
    problems.push(`Amount ${a.maxAmountRequired} is not the listed price (${expected.priceAtomic} atomic USDC).`)
  }
  if (!Number.isInteger(a.maxTimeoutSeconds) || a.maxTimeoutSeconds <= 0) problems.push('maxTimeoutSeconds is missing or not a whole number of seconds.')
  else if (a.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) problems.push(`maxTimeoutSeconds is ${a.maxTimeoutSeconds}, over the ${MAX_TIMEOUT_SECONDS} s this page signs for.`)
  if (typeof a.extra?.name !== 'string' || typeof a.extra?.version !== 'string') problems.push('extra.name / extra.version (the USDC EIP-712 domain) are missing.')
  return problems
}

/**
 * Picks the Avalanche "exact" offer and checks it against the registry. Refuses (ok: false) rather than signing an
 * offer that pays someone else, a different amount, another token or another chain.
 */
export function selectRequirements(pr: PaymentRequired, expected: Expected): Selection {
  const candidates = pr.accepts.filter((a) => a.network === X402_NETWORK && a.scheme === 'exact')
  if (candidates.length === 0) {
    const offered = pr.accepts.map((a) => `${a.scheme}/${a.network}`).join(', ')
    return { ok: false, problems: [`No "exact" offer on Avalanche mainnet. Offered: ${offered || 'none'}.`] }
  }
  let first: string[] | null = null
  for (const a of candidates) {
    const problems = problemsWith(a, expected)
    if (problems.length === 0) return { ok: true, requirements: a as ValidRequirements }
    first ??= problems
  }
  return { ok: false, problems: first ?? [] }
}

/** 32 random bytes from the browser's CSPRNG, as x402's createNonce does. */
export function randomNonce(): Hex {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

export interface Authorization {
  from: Address
  to: Address
  value: string
  validAfter: string
  validBefore: string
  nonce: Hex
}

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/** The authorization and the EIP-712 typed data to sign for it. `nowSec` and `nonce` are inputs so tests are exact. */
export function buildAuthorization(o: { from: string; requirements: ValidRequirements; nowSec: number; nonce: Hex }) {
  const r = o.requirements
  const authorization: Authorization = {
    from: getAddress(o.from),
    to: getAddress(r.payTo),
    value: BigInt(r.maxAmountRequired).toString(),
    validAfter: String(o.nowSec - VALID_AFTER_SKEW_SECONDS),
    validBefore: String(o.nowSec + r.maxTimeoutSeconds),
    nonce: o.nonce,
  }
  const typedData = {
    domain: { name: r.extra.name, version: r.extra.version, chainId: AVALANCHE_CHAIN_ID, verifyingContract: getAddress(USDC_ADDRESS) },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization' as const,
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  }
  return { authorization, typedData }
}

export interface PaymentPayload {
  x402Version: 1
  scheme: 'exact'
  network: string
  payload: { signature: Hex; authorization: Authorization }
}

export function paymentPayload(requirements: PaymentRequirements, authorization: Authorization, signature: Hex): PaymentPayload {
  return { x402Version: 1, scheme: 'exact', network: requirements.network, payload: { signature, authorization } }
}

/** The X-PAYMENT header value: base64 of the JSON payload (all ASCII, so btoa is exact). */
export function encodePaymentHeader(p: PaymentPayload): string {
  return btoa(JSON.stringify(p))
}

export function decodePaymentHeader(header: string): PaymentPayload {
  return JSON.parse(atob(header)) as PaymentPayload
}

export interface SettlementInfo {
  success: boolean | null
  transaction: Hex | null
  network: string | null
  payer: string | null
  raw: unknown
}

const HASH = /^0x[0-9a-fA-F]{64}$/

/** X-PAYMENT-RESPONSE: base64 JSON { success, transaction, network, payer }. Null when it is missing or unreadable. */
export function decodePaymentResponse(header: string | null | undefined): SettlementInfo | null {
  if (!header) return null
  try {
    const raw: unknown = JSON.parse(atob(header.trim()))
    if (!isObject(raw)) return null
    const tx = typeof raw.transaction === 'string' ? raw.transaction : typeof raw.txHash === 'string' ? raw.txHash : null
    return {
      success: typeof raw.success === 'boolean' ? raw.success : null,
      transaction: tx && HASH.test(tx) ? (tx as Hex) : null,
      network: typeof raw.network === 'string' ? raw.network : null,
      payer: typeof raw.payer === 'string' ? raw.payer : null,
      raw,
    }
  } catch {
    return null
  }
}

/** Only https endpoints are called, and only the service's own origin and path prefix if the URL is edited. */
export function checkRequestUrl(endpoint: string, requested: string): URL {
  let base: URL
  let url: URL
  try {
    base = new URL(endpoint)
    url = new URL(requested)
  } catch {
    throw new X402Error('That is not a valid URL.')
  }
  if (base.protocol !== 'https:' || url.protocol !== 'https:') throw new X402Error('Only https endpoints can be called from this page.')
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new X402Error(`The URL must stay on this service's endpoint (${base.origin}${base.pathname}).`)
  if (url.username || url.password) throw new X402Error('The URL must not carry credentials.')
  return url
}

/** The endpoint recorded with a rating: origin and path, never the query string, as the SDK does. */
export function feedbackEndpoint(url: string): string {
  const u = new URL(url)
  return `${u.origin}${u.pathname}`
}

/** 1 to 5 stars on ERC-8004's 0 to 100 scale: 20, 40, 60, 80, 100. */
export function starsToValue(stars: number): number {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new X402Error('A rating is 1 to 5 stars.')
  return stars * 20
}

export const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

export const ERC20_BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

/** giveFeedback arguments: the settlement tx is the proof chainpe-cloud checks, tag1 "x402" marks it as a paid rating. */
export function feedbackArgs(o: { agentId: string; stars: number; url: string; settlementTx: string }) {
  if (!/^\d+$/.test(o.agentId) || o.agentId === '0') throw new X402Error('This service has no ERC-8004 agent to rate.')
  if (!HASH.test(o.settlementTx)) throw new X402Error('No settlement transaction to attach as proof.')
  return [BigInt(o.agentId), BigInt(starsToValue(o.stars)), 0, 'x402', '', feedbackEndpoint(o.url), '', o.settlementTx as Hex] as const
}
