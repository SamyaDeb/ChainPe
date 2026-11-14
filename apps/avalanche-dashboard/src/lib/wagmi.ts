import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { disconnect } from 'wagmi/actions'
import { WALLETCONNECT_PROJECT_ID } from './env'
import { avalancheChain, AVALANCHE_RPC_URL } from './wallet'

/** True when this build can pair a phone wallet over WalletConnect, which is what draws the QR code. */
export const QR_ENABLED = WALLETCONNECT_PROJECT_ID !== ''

/**
 * Smart wallets are left out on purpose. A counterfactual account that is not deployed on Avalanche
 * cannot pass the API's ERC-1271 check, so sign-in would fail with "Invalid signature".
 */
const connectors = connectorsForWallets(
  QR_ENABLED
    ? [
        { groupName: 'Recommended', wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet] },
        { groupName: 'More', wallets: [rabbyWallet, injectedWallet] },
      ]
    : [{ groupName: 'Browser wallets', wallets: [injectedWallet] }],
  {
    appName: 'ChainPe',
    appDescription: 'Provider dashboard on Avalanche',
    appUrl: window.location.origin,
    // RainbowKit refuses an empty id. injectedWallet never uses it, so nothing leaves the browser with this value.
    projectId: WALLETCONNECT_PROJECT_ID || 'walletconnect-not-configured',
  },
)

export const wagmiConfig = createConfig({
  chains: [avalancheChain],
  connectors,
  transports: { [avalancheChain.id]: http(AVALANCHE_RPC_URL) },
})

/**
 * Ends every wallet connection. On reload wagmi reconnects each authorized connector, so one extension can be
 * connected twice (MetaMask and Browser Wallet), and a plain disconnect only falls back to the other one.
 */
export async function disconnectAll(): Promise<void> {
  for (const { connector } of [...wagmiConfig.state.connections.values()]) {
    await disconnect(wagmiConfig, { connector })
  }
}
