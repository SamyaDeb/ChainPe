/**
 * One-time setup: makes a wallet per agent plus a reviewer, writes their keys to
 * .env here (ignored by git), tops them up from the buyer, and writes each agent's
 * proxy config. Safe to run again: it keeps keys and agentIds and only tops up.
 *
 * The buyer is CHAINPE_PRIVATE_KEY from the repo root .env.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { chainFor, getUsdcAddress, publicClientFor, rpcUrlFor } from '@chainpearc/sdk'
import { AGENTS, NETWORK, QUOTE_PRICE, SIZES, addUsdc, describe } from './agents.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '.env')
const generated = path.join(here, 'generated')
/** Agents start with enough USDC for gas and refunds. The reviewer pays for real swaps. */
const AGENT_FLOAT = '1'
const REVIEWER_FLOAT = '6'

const buyerKey = dotenv.parse(fs.readFileSync(path.join(here, '../../.env'))).CHAINPE_PRIVATE_KEY
if (!buyerKey) throw new Error('CHAINPE_PRIVATE_KEY is not in the repo root .env.')

const existing = fs.existsSync(envFile) ? dotenv.parse(fs.readFileSync(envFile)) : {}
const names = [...Object.values(AGENTS).map((a) => a.envKey), 'REVIEWER_KEY']
const keys = Object.fromEntries(names.map((name) => [name, existing[name] ?? generatePrivateKey()]))
fs.writeFileSync(envFile, names.map((name) => `${name}=${keys[name]}`).join('\n') + '\n', { mode: 0o600 })

const usdc = getUsdcAddress(NETWORK)
const client = publicClientFor(NETWORK)
const buyer = privateKeyToAccount(buyerKey.startsWith('0x') ? buyerKey : `0x${buyerKey}`)
const wallet = createWalletClient({ account: buyer, chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })
const balanceOf = (address) => client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [address] })

async function topUp(label, address, target) {
  const want = parseUnits(target, 6)
  const have = await balanceOf(address)
  if (have < want) {
    const hash = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: 'transfer', args: [address, want - have] })
    await client.waitForTransactionReceipt({ hash })
  }
  console.log(`  ${label.padEnd(12)} ${address}  ${formatUnits(await balanceOf(address), 6)} USDC`)
}

fs.mkdirSync(generated, { recursive: true })
console.log(`Buyer ${buyer.address}: ${formatUnits(await balanceOf(buyer.address), 6)} USDC`)
for (const [id, agent] of Object.entries(AGENTS)) {
  const address = privateKeyToAccount(keys[agent.envKey]).address
  await topUp(agent.name, address, AGENT_FLOAT)

  const file = path.join(generated, `${id}.json`)
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const config = {
    ...previous,
    serviceName: agent.name,
    serviceDescription: describe(agent),
    tags: ['swap', 'dex', 'defi', 'eurc', 'usdc'],
    category: 'FINANCE',
    targetUrl: `http://127.0.0.1:${agent.backendPort}`,
    pricePerRequest: QUOTE_PRICE,
    paymentToken: 'USDC',
    walletAddress: address,
    proxyPort: agent.proxyPort,
    network: NETWORK,
    // Exact only: the swap needs the USDC in the wallet now, and Gateway batches land later.
    rails: ['exact'],
    routes: [
      { path: 'POST /quote', pricePerRequest: QUOTE_PRICE, paymentToken: 'USDC', description: 'Estimate a USDC swap' },
      ...SIZES.map((size) => ({
        path: `POST /swap/${size}`,
        pricePerRequest: addUsdc(size, agent.fee),
        paymentToken: 'USDC',
        description: `Swap ${size} USDC, paid for by this call, and send the output to recipient`,
      })),
    ],
    logLevel: 'normal',
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
}
await topUp('Reviewer', privateKeyToAccount(keys.REVIEWER_KEY).address, REVIEWER_FLOAT)
console.log('\nKeys are in examples/arc-swap-agents/.env. Next: npm run up')
