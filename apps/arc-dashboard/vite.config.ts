import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Injects a strict Content-Security-Policy into the BUILT index.html only. The dev server needs inline
 * scripts for hot reload, so it is left alone. connect-src is the API origin, the Arc RPC and WalletConnect.
 * style-src allows inline styles because RainbowKit's modal sets its theme that way. Scripts stay 'self' only.
 */
function cspPlugin(apiUrl: string): Plugin {
  let apiOrigin = ''
  try {
    apiOrigin = apiUrl ? new URL(apiUrl).origin : ''
  } catch {
    apiOrigin = ''
  }
  const walletConnect = [
    'wss://relay.walletconnect.org',
    'wss://relay.walletconnect.com',
    'https://rpc.walletconnect.org',
    'https://rpc.walletconnect.com',
    'https://pulse.walletconnect.org',
    'https://api.web3modal.org',
    'https://explorer-api.walletconnect.com',
  ]
  const connect = [apiOrigin, 'https://rpc.testnet.arc.io', ...walletConnect].filter(Boolean).join(' ')
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://explorer-api.walletconnect.com https://api.web3modal.org",
    "font-src 'self'",
    `connect-src ${connect}`,
    'frame-src https://verify.walletconnect.org https://verify.walletconnect.com',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'chainpe-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
        return html.replace('<head>', `<head>\n    ${tag}`)
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Empty or "/" serves at the root. "/dashboard/" serves under that prefix.
  const rawBase = (env.VITE_BASE_PATH ?? '').trim()
  const base = rawBase === '' || rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}/`
  return {
    base,
    plugins: [react(), cspPlugin(env.VITE_CHAINPE_CLOUD_URL ?? '')],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      ...(base === '/dashboard/' ? { outDir: 'dist/dashboard' } : {}),
      // The CSP has font-src 'self', so a font inlined as a data: URL would be blocked.
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (/node_modules\/(viem|ox|abitype|@noble|wagmi|@wagmi|@rainbow-me|@tanstack)\//.test(id)) return 'web3'
            if (/node_modules\/(react|react-dom)\//.test(id)) return 'react'
            return undefined
          },
        },
      },
    },
    server: {
      allowedHosts: true,
      cors: true,
    },
  }
})
