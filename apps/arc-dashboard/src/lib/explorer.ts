/** The only place that builds a link out of API or onchain data. */

const BASE = 'https://explorer.testnet.arc.io'
const HASH = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export const EXPLORER_BASE = BASE

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

export function isAddressLike(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value)
}

export function txUrl(hash: string | null | undefined): string | null {
  return isHash(hash) ? `${BASE}/tx/${hash}` : null
}

export function addressUrl(address: string | null | undefined): string | null {
  return isAddressLike(address) ? `${BASE}/address/${address}` : null
}

export function shortHex(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}\u2026${value.slice(-4)}` : value
}
