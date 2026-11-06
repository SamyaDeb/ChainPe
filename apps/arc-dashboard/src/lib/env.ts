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

/**
 * ChainPeFees: the only spender this dashboard asks anyone to approve. Set here, not read from the API, so a
 * compromised server cannot point an approval somewhere else. Empty turns the fee card's approve button off.
 */
const DEFAULT_FEES_ADDRESS = '0x09c85EEdeF018274861aae0964f9681C11f91Af4'
export const FEES_ADDRESS: string = (raw.VITE_FEES_ADDRESS ?? DEFAULT_FEES_ADDRESS).trim()

/**
 * From dashboard.reown.com. Public by design: Reown limits it to the project's allowed domains, and every visitor's
 * browser sees it anyway. It lives here because Arc Studio refuses .env files. Set the variable to empty for browser
 * wallets only, with no QR code.
 */
const DEFAULT_WALLETCONNECT_PROJECT_ID = '7aa07d85cda239efbe75641c6e749f9f'
export const WALLETCONNECT_PROJECT_ID: string = (raw.VITE_WALLETCONNECT_PROJECT_ID ?? DEFAULT_WALLETCONNECT_PROJECT_ID).trim()
