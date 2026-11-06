/**
 * @chainpearc/sdk quickstart — payments in 3 lines.
 *
 * Run on Arc testnet:
 *   CHAINPE_PRIVATE_KEY=0x... PAID_URL=https://... npx tsx examples/quickstart.ts
 *
 * The wallet needs a little test USDC (https://faucet.circle.com → Arc Testnet).
 * Circle settles the payment. Any gas on Arc is paid in USDC.
 */
import { ChainPe } from '../src/index.js'

const privateKey = process.env.CHAINPE_PRIVATE_KEY
if (!privateKey) throw new Error('Set CHAINPE_PRIVATE_KEY')

// 1. Create the client.
const cp = new ChainPe({ privateKey, network: 'arc-testnet' })

console.log('wallet:', cp.getAddress())
console.log('balance:', await cp.balance())

// 2. Discover services, ranked by ERC-8004 rating.
const services = await cp.discover()
console.log(`\n${services.length} services found:`)
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
