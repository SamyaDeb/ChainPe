/** Environment, parsed once at boot. A bad value stops the service rather than running half-configured. */
import { z } from 'zod'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const list = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
)

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must have at least 32 characters'),
  AVALANCHE_RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().default(43114),
  // ChainPeRegistry proxy on Avalanche C-Chain (contracts/deployments/avalanche.json).
  CHAINPE_REGISTRY_ADDRESS: address.default('0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E'),
  // First block the indexer reads: ERC-8004 reputation was deployed at 88207994, the registry proxy at 88208064.
  REGISTRY_DEPLOY_BLOCK: z.coerce.bigint().default(88_207_990n),
  // Native USDC on Avalanche C-Chain, 6 decimals.
  USDC_ADDRESS: address.default('0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'),
  ERC8004_IDENTITY_REGISTRY: address.default('0xB1330d7B1b083ba689C7f56bDf667F1F528a3195'),
  ERC8004_REPUTATION_REGISTRY: address.default('0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543'),
  // eth_getLogs block range. The public Avalanche RPC refuses more than 100 (the default); raise it to 2000 or more only with a provider RPC.
  GETLOGS_MAX_BLOCKS: z.coerce.bigint().min(100n).default(100n),
  // Gap between getLogs calls. The public RPC's Cloudflare limit (error 1015) needs about 1000 ms.
  GETLOGS_GAP_MS: z.coerce.number().int().min(0).default(400),
  CORS_ORIGIN: list,
  // Extra origins that may read /v1/public from a browser. https://chainpe.vercel.app and the SIWE hosts are always allowed.
  PUBLIC_CORS_ORIGIN: list.optional(),
  // Providers whose aggregate summary is public at /v1/public/providers/:address/summary (the dashboard's sample
  // provider page), comma-separated. Unset or empty: that endpoint answers 404 for every address.
  SAMPLE_PROVIDERS: list.pipe(z.array(address)).default([]),
  // Hosts the dashboard is served from, comma-separated. Sign-in uses the one the browser's Origin names; the first is the default.
  SIWE_DOMAIN: list.pipe(z.array(z.string().min(1)).min(1)),
  SIWE_CLI_DOMAIN: z.string().min(1),
  WORKERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Folder holding the built dashboard. Set in the Docker image; unset runs the API alone.
  DASHBOARD_DIR: z.string().min(1).optional(),
  PORT: z.coerce.number().int().default(4700),
})

export type Env = z.output<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    // Names only: a value here could be a secret.
    const names = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n  ${names.join('\n  ')}`)
  }
  return parsed.data
}
