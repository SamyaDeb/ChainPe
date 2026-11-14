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

/**
 * From dashboard.reown.com. Public by design: Reown limits it to the project's allowed domains, and every visitor's
 * browser sees it anyway. Set the variable to empty for browser wallets only, with no QR code.
 */
const DEFAULT_WALLETCONNECT_PROJECT_ID = '7aa07d85cda239efbe75641c6e749f9f'
export const WALLETCONNECT_PROJECT_ID: string = (raw.VITE_WALLETCONNECT_PROJECT_ID ?? DEFAULT_WALLETCONNECT_PROJECT_ID).trim()

/**
 * The provider shown read-only at /sample ("View sample provider" on sign-in), from GET
 * /v1/public/providers/:address/summary. The backend serves only addresses in its SAMPLE_PROVIDERS allowlist.
 * Unset hides the button. In mock mode it defaults to the provider in src/mock/fixtures/public-provider-summary.json, so the page can be previewed.
 */
const MOCK_SAMPLE_PROVIDER = '0xeD99A0cC39179f850D0a3Aa1fD2D0280B3efc35f'
const sampleRaw = (raw.VITE_SAMPLE_PROVIDER ?? '').trim()
export const SAMPLE_PROVIDER: string | null = /^0x[0-9a-fA-F]{40}$/.test(sampleRaw) ? sampleRaw : USE_MOCK ? MOCK_SAMPLE_PROVIDER : null
