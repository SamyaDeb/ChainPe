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
  ARC_RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().default(5042002),
  CHAINPE_ACCOUNTS_ADDRESS: address,
  ACCOUNTS_DEPLOY_BLOCK: z.coerce.bigint(),
  ERC8004_IDENTITY_REGISTRY: address,
  ERC8004_REPUTATION_REGISTRY: address,
  CIRCLE_GATEWAY_URL: z.string().url(),
  CORS_ORIGIN: list,
  SIWE_DOMAIN: z.string().min(1),
  SIWE_CLI_DOMAIN: z.string().min(1),
  // Usage fee, spec 12. Without FEES_ADDRESS the service charges nothing. Without the key it records fees but collects none.
  FEES_ADDRESS: address.optional(),
  FEE_COLLECTOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex key').optional(),
  FEES_START_AT: z.coerce.date().optional(),
  FEE_BPS_FREE: z.coerce.number().int().min(0).max(500).default(100),
  FEE_BPS_PRO: z.coerce.number().int().min(0).max(500).default(50),
  FEE_COLLECT_AT_ATOMIC: z.coerce.bigint().default(1_000_000n),
  FEE_COLLECT_MIN_ATOMIC: z.coerce.bigint().default(50_000n),
  FEE_LOCK_AT_ATOMIC: z.coerce.bigint().default(5_000_000n),
  WORKERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
