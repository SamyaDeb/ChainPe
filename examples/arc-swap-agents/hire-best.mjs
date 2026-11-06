/**
 * An agent hiring another agent, with no chat: `node hire-best.mjs`.
 *
 * Discovers the swap agents, keeps those tied for the best on-chain rating, pays
 * each for a quote, hires the best value, measures the EURC that really arrives, and
 * posts that score to ERC-8004. Every step is a real transaction on Arc Testnet.
 * The buyer is CHAINPE_PRIVATE_KEY from the repo root .env.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPe } from '@chainpearc/sdk'
import { AGENTS, NETWORK, eurcBalance, scoreFor } from './agents.mjs'

const SIZE = '0.5'
const EXPLORER = 'https://testnet.arcscan.app/tx'
const here = path.dirname(fileURLToPath(import.meta.url))
const key = process.env.CHAINPE_PRIVATE_KEY ?? dotenv.parse(fs.readFileSync(path.join(here, '../../.env'))).CHAINPE_PRIVATE_KEY
if (!key) throw new Error('CHAINPE_PRIVATE_KEY is not set.')

const me = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`).address
const cp = new ChainPe({ privateKey: key, network: NETWORK, rails: ['exact'], maxPerCall: '1.10' })
const jsonPost = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeout: 120_000 })
const url = (service, route) => `${service.endpoint.replace(/\/+$/, '')}${route}`
const feeOf = (service) => Object.values(AGENTS).find((a) => a.name === service.name).fee

console.log(`Buyer ${me}\n\nDiscovering swap agents on Arc...`)
const names = Object.values(AGENTS).map((a) => a.name)
const found = (await cp.discover({ query: 'swap', tags: ['swap'] })).filter((s) => names.includes(s.name))
if (found.length === 0) throw new Error('No swap agents are listed. Is up.mjs running?')
for (const s of found) {
  console.log(`  ${s.name.padEnd(12)} rating ${String(Math.round(s.reputation?.score ?? 0)).padStart(3)}/100 from ${s.reputation?.count ?? 0} reviews, fee ${feeOf(s)} USDC`)
}

const top = Math.max(...found.map((s) => s.reputation?.score ?? 0))
const shortlist = found.filter((s) => (s.reputation?.score ?? 0) === top)
for (const s of found.filter((x) => !shortlist.includes(x))) console.log(`\nRejected ${s.name}: rated below the best, whatever its fee.`)

console.log('\nPaying for live quotes...')
const quotes = []
for (const service of shortlist) {
  const res = await cp.pay(url(service, '/quote'), jsonPost({ tokenOut: 'EURC', amountIn: SIZE }))
  if (!res.ok) {
    console.log(`  ${service.name}: no quote (HTTP ${res.status})`)
    continue
  }
  const output = Number(res.data.estimatedOutput)
  const value = output / (Number(SIZE) + Number(feeOf(service)))
  console.log(`  ${service.name.padEnd(12)} ${output} EURC for ${SIZE} USDC, paid ${res.payment.amount} USDC for the quote`)
  quotes.push({ service, output, value })
}
if (quotes.length === 0) throw new Error('No agent could quote.')
const best = quotes.reduce((a, b) => (b.value > a.value ? b : a))

console.log(`\nHiring ${best.service.name}: best EURC for each USDC paid.`)
const before = await eurcBalance(me)
const res = await cp.pay(url(best.service, `/swap/${SIZE}`), jsonPost({ tokenOut: 'EURC', recipient: me }))
const received = Number(formatUnits((await eurcBalance(me)) - before, 6))
const status = res.data?.status ?? `http-${res.status}`
console.log(`  Paid     ${res.payment?.amount} USDC  ${EXPLORER}/${res.payment?.txHash}`)
console.log(`  Swap     ${status}  ${res.data?.explorerUrl ?? res.data?.refundTxHash ?? 'none'}`)
console.log(`  Measured ${received} EURC on-chain, against ${best.output} quoted`)

const score = scoreFor({ status, quoted: best.output, received })
const txHash = await cp.giveFeedback(best.service.agentId, score, { endpoint: best.service.endpoint, tag: 'measured-swap', waitConfirm: true })
console.log(`\nRated ${best.service.name} ${score}/100 on ERC-8004  ${EXPLORER}/${txHash}`)
if (status !== 'completed') process.exitCode = 1
