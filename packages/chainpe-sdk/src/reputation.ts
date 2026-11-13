/**
 * ERC-8004 reputation — read aggregate scores + post feedback.
 *
 * A provider's score is the aggregate of feedback left by paying clients on the
 * ERC-8004 Reputation Registry. `getSummary` reverts on an empty client list, so
 * we always enumerate clients via `getClients` first (empty ⇒ unscored). The
 * registry blocks self-feedback, so a provider can't inflate its own score.
 */
import { createWalletClient, http, type Hex, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  publicClientFor,
  rpcUrlFor,
  chainFor,
  normalizeKey
} from './networks.js'
import type { ChainPeNetwork, ReputationSummary } from './types.js'

const ZERO_HASH: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

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

/** Converts the on-chain (value, decimals) summary into a human score. Pure. */
export function summaryToScore(summaryValue: bigint, decimals: number): number {
  return Number(summaryValue) / 10 ** decimals
}

/**
 * Reads a provider agent's aggregate reputation. Returns null when the agent is
 * unlinked (`agentId` 0/empty) or no registry is configured; `count: 0` when the
 * agent exists but has no feedback yet.
 */
export async function getReputation(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  agentId: string
): Promise<ReputationSummary | null> {
  if (!agentId || agentId === '0') return null
  if (!registry) return null

  try {
    const client = publicClientFor(network)
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

    return {
      count: Number(count),
      score: summaryToScore(summaryValue, Number(decimals))
    }
  } catch {
    return null
  }
}

export interface GiveFeedbackParams {
  agentId: string
  /** Score, typically 0–100 (valueDecimals 0). */
  value: number
  endpoint?: string
  tag?: string
  /** Await the receipt before returning. Defaults to false. */
  waitConfirm?: boolean
}

/** Posts ERC-8004 feedback for a provider agent. Returns the tx hash. */
export async function giveFeedback(
  network: ChainPeNetwork,
  registry: `0x${string}` | undefined,
  privateKey: string,
  params: GiveFeedbackParams
): Promise<string> {
  if (!registry) throw new Error('Reputation registry address not configured')

  const account = privateKeyToAccount(normalizeKey(privateKey))
  const wallet: WalletClient = createWalletClient({
    account,
    chain: chainFor(network),
    transport: http(rpcUrlFor(network))
  })

  const hash = await wallet.writeContract({
    account,
    chain: chainFor(network),
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
    await publicClientFor(network).waitForTransactionReceipt({ hash })
  }
  return hash
}
