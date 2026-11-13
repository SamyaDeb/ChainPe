/**
 * Register a seller agent's service on the ChainPe on-chain registry
 * (non-interactive). Auto-mints an ERC-8004 identity if SELLER_AGENT_ID is
 * not set and the wallet doesn't already have one.
 *
 * Run (env-driven):
 *   SELLER_KEY=0x... SELLER_NAME="Research Agent" SELLER_ENDPOINT=http://host:4501 \
 *   SELLER_TAGS=ai,research SELLER_PRICE=0.01 \
 *   node register-seller.mjs
 *
 *   SELLER_AGENT_ID is now optional — omit it and an identity is minted automatically.
 */
import 'dotenv/config'
import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  decodeEventLog,
} from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPeRegistryClient } from '@chainpe/cli'

const network = process.env.CHAINPE_NETWORK || 'fuji'
const registryAddress = process.env.CHAINPE_REGISTRY_ADDRESS

const CHAIN = network === 'avalanche' ? avalanche : avalancheFuji
const RPC =
  process.env.CHAINPE_RPC_URL ||
  (network === 'avalanche'
    ? 'https://api.avax.network/ext/bc/C/rpc'
    : 'https://api.avax-test.network/ext/bc/C/rpc')

const IDENTITY_REGISTRY =
  process.env.ERC8004_IDENTITY_REGISTRY ||
  (network === 'avalanche'
    ? '' // fill in on mainnet deploy
    : '0x56FEc2359fcDfFa6FA1D3a8AB3b708Ff698161D5')

const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
]

function need(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env ${name}.`)
    process.exit(1)
  }
  return v
}

const privateKey = need('SELLER_KEY')
const sellerName = need('SELLER_NAME')
const endpoint = need('SELLER_ENDPOINT')
const walletAddress = need('SELLER_PAYTO')

const normalizedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
const account = privateKeyToAccount(normalizedKey)

const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) })

// ── ERC-8004 identity ────────────────────────────────────────────────────────
let agentId = process.env.SELLER_AGENT_ID || '0'

if (agentId === '0' && IDENTITY_REGISTRY) {
  const registryAddr = getAddress(IDENTITY_REGISTRY)

  // Check if this wallet already owns an identity token.
  const balance = await pub.readContract({
    address: registryAddr,
    abi: IDENTITY_ABI,
    functionName: 'balanceOf',
    args: [getAddress(walletAddress)],
  }).catch(() => 0n)

  if (balance > 0n) {
    console.log(`ℹ  ${sellerName}: wallet already has an ERC-8004 identity.`)
    console.log(`   Set SELLER_AGENT_ID=<n> to link it, or it will register with agentId=0.`)
  } else {
    console.log(`Minting ERC-8004 identity for "${sellerName}"…`)
    const hash = await wallet.writeContract({
      account,
      chain: CHAIN,
      address: registryAddr,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: ['chainpe://seller-agent'],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash })

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddr.toLowerCase()) continue
      try {
        const ev = decodeEventLog({ abi: IDENTITY_ABI, data: log.data, topics: log.topics })
        if (ev.eventName === 'Registered') {
          agentId = String(ev.args.agentId)
        }
      } catch { /* not our event */ }
    }

    if (agentId === '0') {
      console.warn(`  ⚠ Could not decode agentId from logs. Registering with agentId=0. tx: ${hash}`)
    } else {
      console.log(`✓ ERC-8004 identity minted: agent #${agentId}  (tx ${hash})`)
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const client = new ChainPeRegistryClient(network, registryAddress)
const isUpdate = await client.hasService(walletAddress, sellerName).catch(() => false)

console.log(`${isUpdate ? 'Updating' : 'Registering'} "${sellerName}" → ${endpoint} on ${network}…`)
try {
  const result = await client.registerService({
    privateKey,
    name: sellerName,
    description: process.env.SELLER_DESCRIPTION || `${sellerName} — paid x402 service`,
    tags: (process.env.SELLER_TAGS || 'ai,agent').split(',').map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest: process.env.SELLER_PRICE || '0.01',
    paymentToken: 'USDC',
    walletAddress,
    network,
    agentId,
    isUpdate,
  })
  console.log(`✓ ${isUpdate ? 'updated' : 'registered'}  agentId=${agentId}  tx ${result.txnHash}`)
} catch (err) {
  console.error(`✗ ${err?.message || err}`)
  process.exit(1)
}
