/**
 * Atomic USDC (6 decimals) as strings, bigints and display text.
 * No Number or parseFloat ever touches an amount.
 */

const ATOMIC = /^\d+$/
const SIGNED = /^-?\d+$/
const ONE_CENT = 10_000n
const SCALE = 1_000_000n

export function parseAtomic(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !ATOMIC.test(value)) return null
  return BigInt(value)
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Whole and fractional digits of `atomic`, the fraction padded to 6 places. */
function split(atomic: bigint): { whole: string; frac: string } {
  const whole = atomic / SCALE
  const frac = (atomic % SCALE).toString().padStart(6, '0')
  return { whole: group(whole.toString()), frac }
}

/**
 * Display money. Above zero and under $0.01: 6 decimals. Otherwise 2 decimals, rounded half up.
 * Zero is $0.00. Returns an em dash when the input is not a valid atomic amount.
 */
export function formatUsdc(value: string | bigint | null | undefined): string {
  const atomic = typeof value === 'bigint' ? value : parseAtomic(value)
  if (atomic === null || atomic < 0n) return '\u2014'
  if (atomic === 0n) return '$0.00'
  if (atomic < ONE_CENT) {
    const { whole, frac } = split(atomic)
    return `$${whole}.${frac}`
  }
  const cents = (atomic + ONE_CENT / 2n) / ONE_CENT
  const dollars = group((cents / 100n).toString())
  return `$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`
}

/** Exact amount, up to 6 decimals with trailing zeros trimmed to at least 2. For prices and balances. */
export function formatUsdcExact(value: string | bigint | null | undefined): string {
  const atomic = typeof value === 'bigint' ? value : parseAtomic(value)
  if (atomic === null || atomic < 0n) return '\u2014'
  const { whole, frac } = split(atomic)
  let trimmed = frac
  while (trimmed.length > 2 && trimmed.endsWith('0')) trimmed = trimmed.slice(0, -1)
  return `$${whole}.${trimmed}`
}

/** Sum of valid atomic strings. Invalid entries are ignored. */
export function sumAtomic(values: Array<string | null | undefined>): bigint {
  let total = 0n
  for (const v of values) total += parseAtomic(v) ?? 0n
  return total
}

/** floor(value * max / peak) as a whole number of pixels, by bigint ratio. */
export function scaleToPixels(value: bigint, peak: bigint, maxPixels: number): number {
  if (peak <= 0n || value <= 0n) return 0
  const px = (value * BigInt(maxPixels)) / peak
  return Number(px > BigInt(maxPixels) ? BigInt(maxPixels) : px)
}

/** Share of `part` in `whole` as tenths of a percent (0 to 1000), by bigint ratio. */
export function permille(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0
  const v = (part * 1000n) / whole
  return Number(v > 1000n ? 1000n : v)
}

/** score = value / 10^valueDecimals, from strings. Trailing zeros trimmed. Null if either is invalid. */
export function formatScore(value: string, valueDecimals: number): string | null {
  if (!SIGNED.test(value) || !Number.isInteger(valueDecimals) || valueDecimals < 0 || valueDecimals > 36) {
    return null
  }
  const negative = value.startsWith('-')
  const digits = BigInt(value.replace('-', ''))
  const base = 10n ** BigInt(valueDecimals)
  const whole = (digits / base).toString()
  let frac = valueDecimals === 0 ? '' : (digits % base).toString().padStart(valueDecimals, '0')
  while (frac.endsWith('0')) frac = frac.slice(0, -1)
  return `${negative && (digits !== 0n) ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Success rate in [0,1] as a whole percent. Null shows as a dash. */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '\u2014'
  return `${Math.round(rate * 100)}%`
}
