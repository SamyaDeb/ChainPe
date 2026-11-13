/**
 * @chainpe/sdk quickstart — payments in 3 lines.
 *
 * Run against the live Avalanche Fuji facilitator:
 *   CHAINPE_PRIVATE_KEY=0x... PAID_URL=https://... npx tsx examples/quickstart.ts
 *
 * The wallet needs a little Fuji USDC (https://faucet.circle.com → Avalanche Fuji).
 * Gas is paid by the provider's facilitator, so no AVAX is required to pay.
 */
import { ChainPe } from '../src/index.js'

const privateKey = process.env.CHAINPE_PRIVATE_KEY
if (!privateKey) throw new Error('Set CHAINPE_PRIVATE_KEY')

// 1. Create the client.
const cp = new ChainPe({ privateKey, network: 'fuji' })

console.log('wallet:', cp.getAddress())
console.log('balance:', await cp.balance())

// 2. Discover services (ranked by on-chain ⭐ reputation).
const services = await cp.discover()
console.log(`\n${services.length} services on-chain:`)
for (const s of services.slice(0, 5)) {
  const rep = s.reputation
  const stars = rep?.score != null ? `⭐ ${rep.score} (${rep.count})` : 'unrated'
  console.log(`  • ${s.name} — ${s.pricePerRequest} USDC — ${stars}`)
}

// 3. Pay a 402 endpoint and read the data (auto-pays USDC via EIP-3009).
const url = process.env.PAID_URL ?? services[0]?.endpoint
if (url) {
  const res = await cp.pay(url)
  console.log('\npaid call:', res.status, res.payment)
  console.log('data:', res.data)
}
