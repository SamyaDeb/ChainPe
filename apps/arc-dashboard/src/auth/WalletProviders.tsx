import { useState, type ReactNode } from 'react'
import { darkTheme, lightTheme, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { useTheme } from '@/lib/theme'
import { wagmiConfig } from '@/lib/wagmi'
import { arcTestnet } from '@/lib/wallet'

const look = { borderRadius: 'none', overlayBlur: 'small' } as const

/** The wallet connection. Sign-in itself stays in AuthContext, which keeps its checks on the server's message. */
export function WalletProviders({ children }: { children: ReactNode }) {
  const { theme } = useTheme()
  const [queryClient] = useState(() => new QueryClient())
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={arcTestnet}
          modalSize="compact"
          theme={theme === 'dark' ? darkTheme({ ...look, accentColor: '#f5f5f5', accentColorForeground: '#111111' }) : lightTheme({ ...look, accentColor: '#111111', accentColorForeground: '#ffffff' })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
