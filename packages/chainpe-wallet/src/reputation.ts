/**
 * ERC-8004 Reputation — read scores + post feedback.
 *
 * A provider's score is the aggregate of feedback left by paying clients on the
 * ERC-8004 Reputation Registry. After a successful x402 payment, the consumer
 * can call `giveFeedback(agentId, …)`; discovery reads `getSummary` to surface a
 * score. ERC-8004 blocks self-feedback, so a provider cannot inflate its own.
 */
import { createWalletClient, http, getAddress, type Hex } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import type { AppConfig, PaymentNetwork } from '@/types.js'
import { publicClientFor, rpcUrlFor } from '@/clients.js'

const CHAINS = { fuji: avalancheFuji, avalanche }
const ZERO_HASH: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

// Deployed ERC-8004 Reputation Registry per network (override via env/config).
const DEFAULT_REPUTATION: Record<PaymentNetwork, `0x${string}` | undefined> = {
  fuji: '0x89476DfEf9c72a668fa5E86f154B73EDB053aFe4',
  avalanche: undefined
}

const REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' }
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' }
    ]
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }]
  }
] as const

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`
}

export function resolveReputationRegistry(
  config: AppConfig
): `0x${string}` | undefined {
  const candidate =
    config.reputationRegistry ??
    process.env.ERC8004_REPUTATION_REGISTRY ??
    DEFAULT_REPUTATION[config.network]
  return candidate ? getAddress(candidate) : undefined
}

export interface ReputationSummary {
  count: number
  /** Aggregate score (e.g. 0–100), or null when there is no feedback yet. */
  score: number | null
}

/**
 * Reads a provider's reputation. getSummary requires the client list, so we
 * enumerate clients first via getClients. Returns count 0 when unscored.
 */
export async function getReputation(
  config: AppConfig,
  agentId: string
): Promise<ReputationSummary | null> {
  if (!agentId || agentId === '0') return null
  const registry = resolveReputationRegistry(config)
  if (!registry) return null

  try {
    const client = publicClientFor(config.network)
    const id = BigInt(agentId)
    const clients = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getClients',
      args: [id]
    })) as readonly `0x${string}`[]

    if (clients.length === 0) return { count: 0, score: null }

    const [count, summaryValue, decimals] = (await client.readContract({
      address: registry,
      abi: REPUTATION_ABI,
      functionName: 'getSummary',
      args: [id, clients as `0x${string}`[], '', '']
    })) as readonly [bigint, bigint, number]

    const score = Number(summaryValue) / 10 ** Number(decimals)
    return { count: Number(count), score }
  } catch {
    return null
  }
}

/**
 * Posts feedback for an agent. `value` is a 0–100 score (valueDecimals 0).
 * By default does not wait for confirmation (keeps callers fast); pass
 * waitConfirm to await the receipt.
 */
export async function giveFeedback(
  config: AppConfig,
  params: {
    agentId: string
    value: number
    endpoint?: string
    tag?: string
    waitConfirm?: boolean
  }
): Promise<string> {
  if (!config.privateKey) throw new Error('No wallet configured')
  const registry = resolveReputationRegistry(config)
  if (!registry) throw new Error('Reputation registry address not configured')

  const account = privateKeyToAccount(normalizeKey(config.privateKey))
  const wallet = createWalletClient({
    account,
    chain: CHAINS[config.network],
    transport: http(rpcUrlFor(config.network))
  })

  const hash = await wallet.writeContract({
    address: registry,
    abi: REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [
      BigInt(params.agentId),
      BigInt(Math.round(params.value)),
      0,
      'x402',
      params.tag ?? 'paid-call',
      params.endpoint ?? '',
      '',
      ZERO_HASH
    ]
  })

  if (params.waitConfirm) {
    await publicClientFor(config.network).waitForTransactionReceipt({ hash })
  }
  return hash
}
