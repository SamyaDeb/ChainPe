import { getAddress } from 'viem'
import { z } from 'zod'

/** JSON error with a stable code: { error, message }. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export const planRequired = (message: string) => new HttpError(403, 'plan_required', message)
export const chainUnavailable = () => new HttpError(503, 'chain_unavailable', 'Could not read Arc. Try again shortly.')

export const zAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address')
  .transform((v) => v.toLowerCase())

export const zBytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be 32 bytes of hex')

/** Parses with zod, turning any problem into a 400. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const detail = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ')
  throw new HttpError(400, 'invalid_request', detail)
}

export function checksum(address: string): string {
  return address === 'unknown' ? address : getAddress(address)
}

export const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null)

/** On-chain strings are untrusted (review L-2): a link is only offered for https. */
export function httpsOnly(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null
  } catch {
    return null
  }
}

/** "0.01" to 10000n. Null for anything else, since the contract only checks that a price has a digit. */
export function priceToAtomic(price: string): string | null {
  const match = /^(\d{1,20})(?:\.(\d{1,6}))?$/.exec(price)
  if (!match) return null
  return (BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'))).toString()
}

/** 18-decimal system-emitter value to 6-decimal atomic USDC, or null if it is not a whole amount. */
export function toAtomic6(value18: bigint): bigint | null {
  return value18 % 1_000_000_000_000n === 0n ? value18 / 1_000_000_000_000n : null
}

/** Atomic USDC as a decimal string. Used only at the edge, for CSV. */
export function formatUsdc(atomic: string): string {
  const padded = atomic.padStart(7, '0')
  return `${padded.slice(0, -6)}.${padded.slice(-6)}`
}

/** viem's long messages can quote the RPC URL, which may hold an API key. */
export function safeMessage(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string }
  return (e.shortMessage ?? e.message ?? 'unknown error').split('\n')[0].slice(0, 300)
}
