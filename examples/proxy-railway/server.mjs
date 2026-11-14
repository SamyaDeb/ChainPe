/**
 * ChainPe x402 Proxy — Railway deployment (Avalanche C-Chain mainnet)
 *
 * One x402 payment proxy in front of examples/weather-railway, with three paid routes.
 * Each route is its own ChainPe service: its own price and its own payTo wallet, so each
 * one gets its own ERC-8004 identity and its own reputation.
 *
 *   route            default price   payTo env (falls back to WALLET_ADDRESS)
 *   /weather         $0.01           WEATHER_PAY_TO
 *   /summarize       $0.02           SUMMARIZE_PAY_TO
 *   /cheap-weather   $0.005          CHEAP_WEATHER_PAY_TO   (deliberately bad data)
 *
 * Env:
 *   TARGET_URL        backend base URL (required), e.g. http://weather-backend.railway.internal:8080
 *   WALLET_ADDRESS    default payTo for any route without its own *_PAY_TO
 *   WEATHER_PRICE / SUMMARIZE_PRICE / CHEAP_WEATHER_PRICE   USDC price overrides, e.g. "0.01"
 *   NETWORK           "avalanche" (default) or "fuji"
 *   FACILITATOR_URL   x402 facilitator (default: the hosted ChainPe facilitator)
 *   CORS_ORIGINS      extra comma-separated browser origins (chainpe.vercel.app + chainpe-cloud are always allowed)
 *   SERVICE_NAME      display name in the 402 paywall (default: "ChainPe demo services")
 *   PORT              HTTP port (Railway injects this)
 *
 * Payments are USDC via x402 (EIP-3009). The payer signs the authorization; the facilitator
 * submits it on-chain and pays the gas. The hosted facilitator only settles to payTo addresses
 * that are registered in ChainPeRegistry, so register each route before calling it.
 */

import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { paymentMiddleware } from 'x402-express'

// ── Config from environment ────────────────────────────────────────────────

const DEFAULT_FACILITATOR = 'https://chainpe-facilitator-production-000a.up.railway.app'
const DEFAULT_ORIGINS = ['https://chainpe.vercel.app', 'https://chainpe-cloud-production-1d71cb77.up.railway.app']

const TARGET_URL = process.env.TARGET_URL
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const NETWORK = process.env.NETWORK ?? 'avalanche'
const FACILITATOR_URL = (process.env.FACILITATOR_URL || DEFAULT_FACILITATOR).replace(/\/+$/, '')
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'ChainPe demo services'
const PORT = parseInt(process.env.PORT ?? '4402', 10)
// The dashboard's "Try it" runs on both hosts, so they are always allowed; CORS_ORIGINS adds more.
const CORS_ORIGINS = [
  ...new Set([...DEFAULT_ORIGINS, ...(process.env.CORS_ORIGINS ?? '').split(',')].map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)),
]

if (NETWORK !== 'avalanche' && NETWORK !== 'fuji') {
  console.error(`NETWORK must be "avalanche" or "fuji", got "${NETWORK}"`)
  process.exit(1)
}
const X402_NETWORK = NETWORK === 'avalanche' ? 'avalanche' : 'avalanche-fuji'

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)

const ROUTES = [
  {
    path: '/weather',
    price: process.env.WEATHER_PRICE ?? '0.01',
    payTo: process.env.WEATHER_PAY_TO || WALLET_ADDRESS,
    description: 'Current weather for a city (?city=London)',
  },
  {
    path: '/summarize',
    price: process.env.SUMMARIZE_PRICE ?? '0.02',
    payTo: process.env.SUMMARIZE_PAY_TO || WALLET_ADDRESS,
    description: 'Extractive text summary (?text=... or POST {"text": "..."})',
  },
  {
    path: '/cheap-weather',
    price: process.env.CHEAP_WEATHER_PRICE ?? '0.005',
    payTo: process.env.CHEAP_WEATHER_PAY_TO || WALLET_ADDRESS,
    description: 'Cheap weather for a city (?city=London)',
  },
]

if (!TARGET_URL) {
  console.error('Missing env: TARGET_URL')
  process.exit(1)
}
for (const r of ROUTES) {
  if (!isAddress(r.payTo)) {
    console.error(`Missing or invalid payTo for ${r.path}: set WALLET_ADDRESS or the route's *_PAY_TO`)
    process.exit(1)
  }
  if (!(Number(r.price) > 0)) {
    console.error(`Invalid price for ${r.path}: "${r.price}"`)
    process.exit(1)
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

const app = express()
// Railway terminates TLS in front of us; trust it so the 402 `resource` URL is https.
app.set('trust proxy', 1)

app.use(
  cors({
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
    // Accept is sent so x402-express answers a browser with the JSON 402, not its HTML paywall.
    allowedHeaders: ['Content-Type', 'Accept', 'X-PAYMENT'],
    // Browsers can only read the settlement receipt if it is exposed.
    exposedHeaders: ['X-PAYMENT-RESPONSE'],
    maxAge: 600,
  })
)

// Health check and route list (not gated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, network: NETWORK, x402Network: X402_NETWORK })
})
app.get('/', (_req, res) => {
  res.json({
    service: SERVICE_NAME,
    network: NETWORK,
    routes: ROUTES.map((r) => ({ path: r.path, priceUsdc: r.price, payTo: r.payTo, description: r.description })),
  })
})

// x402 payment gates — one per route, because each route has its own payTo.
// A middleware whose routes do not match the request calls next(), so they chain cleanly.
for (const r of ROUTES) {
  app.use(
    paymentMiddleware(
      r.payTo,
      {
        [r.path]: {
          price: `$${r.price}`,
          network: X402_NETWORK,
          config: { description: `${r.description}. ${r.price} USDC per request.` },
        },
      },
      { url: FACILITATOR_URL },
      { appName: SERVICE_NAME }
    )
  )
}

// Only the exact paid paths reach the backend (app.all keeps req.url intact, query included);
// everything else is a 404 here, so nothing ungated is proxied.
const proxy = createProxyMiddleware({ target: TARGET_URL, changeOrigin: true })
for (const r of ROUTES) app.all(r.path, proxy)
app.use((_req, res) => res.status(404).json({ error: 'not_found', routes: ROUTES.map((r) => r.path) }))

app.listen(PORT, () => {
  console.log(`ChainPe proxy "${SERVICE_NAME}" listening on :${PORT}`)
  console.log(`  → backend ${TARGET_URL}`)
  console.log(`  → network ${NETWORK} (${X402_NETWORK}), facilitator ${FACILITATOR_URL}`)
  for (const r of ROUTES) console.log(`  → ${r.path.padEnd(15)} ${r.price} USDC → ${r.payTo}`)
  console.log(`  → CORS ${CORS_ORIGINS.join(', ')}`)
})
