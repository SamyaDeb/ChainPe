/**
 * NFDomains (.algo / .nfd) name resolution helper.
 * Resolves a human-readable Algorand name to a raw 58-char address.
 */

const NFD_API = 'https://api.nf.domains'

/**
 * Returns true if the string looks like an NFD name (ends with .algo or .nfd).
 */
export function isNfdName(value: string): boolean {
  const lower = value.trim().toLowerCase()
  return lower.endsWith('.algo') || lower.endsWith('.nfd')
}

/**
 * Resolves an NFD name to its deposit address.
 * - Uses `caAlgo` (verified deposit address) when present, otherwise falls back to `owner`.
 * - Throws if the name does not exist or the API is unreachable.
 */
export async function resolveNfd(name: string): Promise<string> {
  const lower = name.trim().toLowerCase()
  const url = `${NFD_API}/nfd/${encodeURIComponent(lower)}?view=brief`

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`NFD name "${name}" not found. Make sure it's a valid .algo or .nfd domain.`)
    }
    throw new Error(`NFD API error ${res.status} while resolving "${name}"`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any

  // caAlgo is the verified deposit address — prefer it over the owner
  const address: string | undefined = data.caAlgo?.[0] ?? data.owner
  if (!address) {
    throw new Error(`NFD "${name}" resolved but has no associated Algorand address.`)
  }

  return address
}
