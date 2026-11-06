/**
 * Build-time configuration. Everything here is public: no secret ever belongs in a VITE_ variable.
 */

const raw: Record<string, string | undefined> = import.meta.env

const cloudUrl = (raw.VITE_CHAINPE_CLOUD_URL ?? '').trim().replace(/\/+$/, '')

/** Mock mode: sample data from src/mock, never sent to or taken from a server. */
export const USE_MOCK: boolean =
  raw.VITE_USE_MOCK === 'true' || (import.meta.env.DEV && cloudUrl === '')

export const CLOUD_URL: string = cloudUrl

/** A production build with neither a backend URL nor mock mode is misconfigured. */
export const CONFIG_ERROR: string | null =
  !USE_MOCK && cloudUrl === ''
    ? 'This build has no backend configured. Set VITE_CHAINPE_CLOUD_URL (or VITE_USE_MOCK=true for a sample-data demo) and rebuild.'
    : null

export const ARC_NETWORK: string = (raw.VITE_ARC_NETWORK ?? 'arc-testnet').trim()
export const ACCOUNTS_ADDRESS: string = (raw.VITE_ACCOUNTS_ADDRESS ?? '').trim()
export const USDC_ADDRESS: string = (raw.VITE_USDC_ADDRESS ?? '').trim()
