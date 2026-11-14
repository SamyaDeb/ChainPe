import 'dotenv/config'
import { getAddress } from 'viem'

export type Network = 'fuji' | 'avalanche'

export const NETWORK: Network =
  process.env.NETWORK === 'avalanche' ? 'avalanche' : 'fuji'

export const RPC_URL =
  process.env.RPC_URL ??
  (NETWORK === 'avalanche'
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc')

const DEFAULT_REGISTRY: Record<Network, string | undefined> = {
  fuji: '0x91677a35599f052E99Ed0ab9E45c17E736a22Bf6',
  avalanche: '0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E'
}
const DEFAULT_REPUTATION: Record<Network, string | undefined> = {
  fuji: '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4',
  avalanche: '0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543'
}

function resolve(envValue: string | undefined, fallback: string | undefined, label: string): `0x${string}` {
  const candidate = envValue ?? fallback
  if (!candidate) throw new Error(`${label} address not set for network "${NETWORK}".`)
  return getAddress(candidate)
}

export const REGISTRY_ADDRESS = resolve(
  process.env.CHAINPE_REGISTRY_ADDRESS,
  DEFAULT_REGISTRY[NETWORK],
  'ChainPeRegistry'
)
export const REPUTATION_ADDRESS = resolve(
  process.env.ERC8004_REPUTATION_REGISTRY,
  DEFAULT_REPUTATION[NETWORK],
  'ERC-8004 Reputation Registry'
)

/** Postgres connection string — required at runtime (not for typecheck/tests). */
export const DATABASE_URL = process.env.DATABASE_URL ?? ''

export const PORT = Number(process.env.PORT ?? 4600)
// Mainnet: just before the earliest ChainPe contract (ERC-8004 reputation 88207994,
// registry proxy 88208064), so a fresh DB doesn't scan 88M empty blocks. Fuji: from genesis.
export const START_BLOCK = BigInt(process.env.START_BLOCK ?? (NETWORK === 'avalanche' ? '88207990' : '0'))
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000)
/** Max block span per getLogs request. The public Avalanche RPC refuses more than 100. */
export const LOG_CHUNK = BigInt(process.env.LOG_CHUNK ?? '100')
