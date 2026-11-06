import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Injects a strict Content-Security-Policy into the BUILT index.html only. The dev server needs inline
 * scripts for hot reload, so it is left alone. connect-src is the API origin plus the Arc RPC.
 */
function cspPlugin(apiUrl: string): Plugin {
  let apiOrigin = ''
  try {
    apiOrigin = apiUrl ? new URL(apiUrl).origin : ''
  } catch {
    apiOrigin = ''
  }
  const connect = [apiOrigin, 'https://rpc.testnet.arc.io'].filter(Boolean).join(' ')
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
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
  return {
    plugins: [react(), cspPlugin(env.VITE_CHAINPE_CLOUD_URL ?? '')],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    build: {
      // The CSP has font-src 'self', so a font inlined as a data: URL would be blocked.
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (/node_modules\/(viem|ox|abitype|@noble)\//.test(id)) return 'web3'
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
