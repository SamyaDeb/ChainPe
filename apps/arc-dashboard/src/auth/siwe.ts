import { isAddressEqual } from 'viem'

/**
 * Checks the message the server returned before the wallet is asked to sign it.
 * Returns a human explanation when the message is not for this site and wallet, otherwise null.
 */
export function checkSiweMessage(message: string, connected: string, host: string): string | null {
  const lines = message.split('\n')
  const header = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? '')
  const address = lines[1] ?? ''
  if (!header) return 'The sign-in message is not in the expected format.'
  const domain = header[1]
  if (domain !== host) {
    return `The sign-in message is for ${domain}, but this app is served from ${host}. The backend's SIWE domain must match this site. Nothing was signed.`
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !isAddressEqual(address as `0x${string}`, connected as `0x${string}`)) {
    return 'The sign-in message is for a different wallet address than the one you connected. Nothing was signed.'
  }
  return null
}
