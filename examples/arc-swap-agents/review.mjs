/**
 * Builds reputation from real paid swaps: `node review.mjs [rounds]`.
 *
 * A separate reviewer wallet hires each agent, measures the EURC that actually
 * arrives against a quote taken just before, and posts that score to ERC-8004.
 * Nothing about any agent is assumed. This is still one wallet's opinion, so say on
 * camera that you seeded the ratings.
 */
import 'dotenv/config'
import { AppKit } from '@circle-fin/app-kit'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPe } from '@chainpearc/sdk'
import { AGENTS, CHAIN, NETWORK, adapterFor, eurcBalance, scoreFor } from './agents.mjs'

const SIZE = '0.5'
const rounds = Number(process.argv[2] ?? 2)
const key = process.env.REVIEWER_KEY
if (!key) throw new Error('REVIEWER_KEY is not set. Run `npm run setup` first.')
const me = privateKeyToAccount(key).address
const cp = new ChainPe({ privateKey: key, network: NETWORK, rails: ['exact'], maxPerCall: '1.10' })
const kit = new AppKit()
const adapter = adapterFor(key)

const services = await cp.discover({ query: 'swap', tags: ['swap'] })

for (const agent of Object.values(AGENTS)) {
  const service = services.find((s) => s.name === agent.name && s.source === 'chainpe')
  if (!service) throw new Error(`${agent.name} is not listed. Is up.mjs running?`)
  const url = `${service.endpoint.replace(/\/+$/, '')}/swap/${SIZE}`

  for (let round = 1; round <= rounds; round++) {
    const quote = await kit.estimateSwap({ from: { adapter, chain: CHAIN }, tokenIn: 'USDC', tokenOut: 'EURC', amountIn: SIZE })
    const before = await eurcBalance(me)
    const res = await cp.pay(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tokenOut: 'EURC', recipient: me }),
      timeout: 120_000,
    })
    const after = await eurcBalance(me)
    const received = Number(formatUnits(after - before, 6))
    const quoted = Number(quote.estimatedOutput.amount)
    const status = res.data?.status ?? `http-${res.status}`
    const score = scoreFor({ status, quoted, received })
    const txHash = await cp.giveFeedback(service.agentId, score, {
      endpoint: service.endpoint,
      tag: 'measured-swap',
      waitConfirm: true,
    })
    console.log(
      `${agent.name.padEnd(12)} round ${round}: ${status}, quoted ${quoted}, received ${received} EURC, ` +
        `score ${score}\n  swap ${res.data?.explorerUrl ?? res.data?.refundTxHash ?? 'none'}\n  feedback ${txHash}`
    )
  }
}

console.log('\nStanding, from the chain:')
for (const s of (await cp.discover({ query: 'swap', tags: ['swap'] })).filter((x) => x.source === 'chainpe')) {
  console.log(`  ${s.name.padEnd(12)} agent ${s.agentId}  score ${s.reputation?.score}  from ${s.reputation?.count} reviews`)
}
