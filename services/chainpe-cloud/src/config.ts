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
