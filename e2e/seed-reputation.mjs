/**
 * Seeds REAL payment-gated reputation on Avalanche mainnet (Phase 3.6). It spends real USDC and AVAX.
 *
 *   1. Funded agent wallets (3-5) pay `weather` and `summarize` several times and rate them HIGH,
 *      each rating carrying its settlement tx (feedbackHash), so chainpe-cloud verifies it as a paid review.
 *   2. The same wallets pay `cheap-weather` a few times and rate it LOW (also verified paid reviews).
 *   3. Five fresh wallets (funded with a little AVAX for gas) each post 3 HIGH ratings to `cheap-weather` WITHOUT ever
 *      paying. chainpe-cloud keeps them out of the paid score, so the raw average looks great and the paid one is bad.
 *      (3 each, not 1: a handful of paid low ratings would otherwise drag the raw average down to ~50.)
 *
 * Dry run is the default. Nothing is sent without EXECUTE=1.
 *
 *   SEED_KEYS=0xk1,0xk2,0xk3 node e2e/seed-reputation.mjs                    # plan + balance check, sends nothing
 *   SEED_KEYS=0xk1,0xk2,0xk3 EXECUTE=1 node e2e/seed-reputation.mjs          # does it
 *   node e2e/seed-reputation.mjs --check                                     # reads the public API and asserts the result
 *
 * Env:
 *   SEED_KEYS            comma-separated private keys of 3-5 funded wallets. They must NOT be any provider's wallet
 *                        (the registry blocks an agent's owner from rating it).
 *   FUNDER_KEY           wallet that funds the five fresh wallets with AVAX (default: the first SEED_KEYS wallet)
 *   CLOUD_URL            chainpe-cloud base URL (default: the hosted one)
 *   CALLS_GOOD / CALLS_CHEAP   paid calls per wallet to weather+summarize each / to cheap-weather (default 3 / 1)
 *   UNPAID_RATERS        number of fresh wallets that post unpaid ratings (default 5)
 *   UNPAID_PER_WALLET    unpaid ratings each fresh wallet posts (default 3)
 *   AVALANCHE_RPC_URL    default public RPC
 */
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem'
import { avalanche } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ChainPe } from '../packages/chainpe-sdk/dist/index.js'

const CLOUD = (process.env.CLOUD_URL ?? 'https://chainpe-cloud-production-1d71cb77.up.railway.app').replace(/\/+$/, '')
const RPC = process.env.AVALANCHE_RPC_URL ?? 'https://api.avax.network/ext/bc/C/rpc'
const EXECUTE = process.env.EXECUTE === '1'
const CALLS_GOOD = Number(process.env.CALLS_GOOD ?? 3)
const CALLS_CHEAP = Number(process.env.CALLS_CHEAP ?? 1)
const UNPAID_RATERS = Number(process.env.UNPAID_RATERS ?? 5)
const UNPAID_PER_WALLET = Number(process.env.UNPAID_PER_WALLET ?? 3)
const UNPAID_TOTAL = UNPAID_RATERS * UNPAID_PER_WALLET
const GAS_PER_RATING_AVAX = 0.01 // a giveFeedback tx is well under this at normal gas prices
const UNPAID_WALLET_AVAX = '0.03' // gas for UNPAID_PER_WALLET ratings

const GOOD = [100, 95, 90, 100, 95, 90]
const BAD = [10, 20, 5, 15, 25]
const QUERY = {
  weather: '?city=London',
  summarize: '?text=' + encodeURIComponent('x402 lets an agent pay for an API call with USDC in one HTTP round trip.'),
  'cheap-weather': '?city=London'
}

const pub = createPublicClient({ chain: avalanche, transport: http(RPC) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (m = '') => console.log(m)
const die = (m) => { console.error(`\n✖ ${m}`); process.exit(1) }

async function services() {
  const res = await fetch(`${CLOUD}/v1/public/services`)
  if (!res.ok) die(`chainpe-cloud answered HTTP ${res.status}`)
  return (await res.json()).services
}

// ── --check: read the public API and assert the headline result ─────────────────────────────────
if (process.argv.includes('--check')) {
  const by = Object.fromEntries((await services()).map((s) => [s.name, s]))
  const row = (n) => by[n] ? `${n.padEnd(14)} paid ${String(by[n].paidScore ?? '-').padStart(5)} (${by[n].paidReviews} verified)   raw ${String(by[n].rawScore ?? '-').padStart(5)} (${by[n].rawReviews} total)` : `${n}: not found`
  ;['weather', 'summarize', 'cheap-weather'].forEach((n) => say(row(n)))
  const cw = by['cheap-weather'], w = by.weather
  const problems = []
  if (!cw || !w) problems.push('weather or cheap-weather is missing from chainpe-cloud')
  else {
    if (!(cw.rawScore >= 70)) problems.push(`cheap-weather raw score should be high (>= 70), is ${cw.rawScore}`)
    if (!(cw.paidScore !== null && cw.rawScore - cw.paidScore >= 30)) problems.push(`raw should beat paid by at least 30 points (raw ${cw.rawScore}, paid ${cw.paidScore})`)
    if (!(cw.paidScore !== null && cw.paidScore <= 40)) problems.push(`cheap-weather paid score should be low (<= 40), is ${cw.paidScore}`)
    if (!(w.paidScore >= 80)) problems.push(`weather paid score should be high (>= 80), is ${w.paidScore}`)
    if (cw.rawReviews - cw.paidReviews < UNPAID_TOTAL) problems.push(`expected at least ${UNPAID_TOTAL} unpaid ratings on cheap-weather, found ${cw.rawReviews - cw.paidReviews}`)
  }
  if (problems.length) die(problems.join('\n  '))
  say('\n✔ cheap-weather: high raw score, low paid score. weather: high paid score.')
  process.exit(0)
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────
const keys = (process.env.SEED_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean).map((k) => (k.startsWith('0x') ? k : `0x${k}`))
if (keys.length < 3 || keys.length > 5) die('Set SEED_KEYS to 3-5 comma-separated funded private keys.')
const wallets = keys.map((k) => ({ key: k, address: privateKeyToAccount(k).address }))
if (new Set(wallets.map((w) => w.address)).size !== wallets.length) die('SEED_KEYS contains a duplicate wallet.')

const all = await services()
const svc = {}
for (const name of ['weather', 'summarize', 'cheap-weather']) {
  const s = all.find((x) => x.name === name && !x.payToShared)
  if (!s) die(`Service "${name}" is not on chainpe-cloud. The runbook depends on Phase 2.4 (deploy + register the three demo services) and on the indexer having caught up.`)
  if (!s.agentId) die(`Service "${name}" has no ERC-8004 agentId, so it cannot be rated. Re-register it with an identity.`)
  svc[name] = s
}
if (svc['cheap-weather'].agentId === svc.weather.agentId) die('cheap-weather and weather share an agentId, so their ratings would mix. Give each its own wallet and identity.')
for (const w of wallets) {
  for (const s of Object.values(svc)) if (s.provider.toLowerCase() === w.address.toLowerCase() || s.payTo.toLowerCase() === w.address.toLowerCase()) die(`${w.address} is a provider wallet. Use different wallets as raters.`)
}

const price = (s) => Number(s.price)
const perWallet = CALLS_GOOD * (price(svc.weather) + price(svc.summarize)) + CALLS_CHEAP * price(svc['cheap-weather'])
const ratingsPerWallet = CALLS_GOOD * 2 + CALLS_CHEAP
const needUsdc = perWallet * 1.2
const needAvax = ratingsPerWallet * GAS_PER_RATING_AVAX
const funderKey = (process.env.FUNDER_KEY ?? keys[0]).startsWith('0x') ? (process.env.FUNDER_KEY ?? keys[0]) : `0x${process.env.FUNDER_KEY}`
const unpaidAvax = UNPAID_RATERS * Number(UNPAID_WALLET_AVAX)

say(`Plan (${EXECUTE ? 'EXECUTE' : 'dry run, nothing will be sent'})`)
say(`  weather        ${svc.weather.price} USDC  agent #${svc.weather.agentId}  → ${svc.weather.payTo}`)
say(`  summarize      ${svc.summarize.price} USDC  agent #${svc.summarize.agentId}  → ${svc.summarize.payTo}`)
say(`  cheap-weather  ${svc['cheap-weather'].price} USDC  agent #${svc['cheap-weather'].agentId}  → ${svc['cheap-weather'].payTo}`)
say(`  ${wallets.length} paying wallets × (${CALLS_GOOD} weather + ${CALLS_GOOD} summarize rated HIGH, ${CALLS_CHEAP} cheap-weather rated LOW) = ${wallets.length * ratingsPerWallet} paid, verified ratings`)
say(`  ${UNPAID_RATERS} fresh wallets × ${UNPAID_PER_WALLET} UNPAID ratings of 100 on cheap-weather (${UNPAID_TOTAL} total)`)
say(`  each paying wallet needs ≈ ${needUsdc.toFixed(3)} USDC and ≈ ${needAvax.toFixed(2)} AVAX; the funder also needs ≈ ${unpaidAvax.toFixed(2)} AVAX for the fresh wallets\n`)

let short = false
for (const w of wallets) {
  const cp = new ChainPe({ privateKey: w.key, network: 'avalanche' })
  const b = await cp.balance()
  const extra = w.key === funderKey ? unpaidAvax : 0
  const ok = Number(b.usdc) >= needUsdc && Number(b.avax) >= needAvax + extra
  if (!ok) short = true
  say(`  ${w.address}  ${Number(b.usdc).toFixed(3)} USDC  ${Number(b.avax).toFixed(3)} AVAX  ${ok ? 'ok' : 'NEEDS FUNDING'}`)
}
if (!wallets.some((w) => w.key === funderKey)) {
  const fb = Number(formatEther(await pub.getBalance({ address: privateKeyToAccount(funderKey).address })))
  if (fb < unpaidAvax) { short = true; say(`  funder ${privateKeyToAccount(funderKey).address}  ${fb.toFixed(3)} AVAX  NEEDS FUNDING (≥ ${unpaidAvax.toFixed(2)})`) }
}
if (!EXECUTE) { say('\nDry run only. Re-run with EXECUTE=1 to spend.'); process.exit(short ? 2 : 0) }
if (short) die('Fund the wallets listed above first.')

// ── execute ──────────────────────────────────────────────────────────────────────────────────────
const ratingsLog = []
async function payAndRate(cp, name, score, tag) {
  const s = svc[name]
  const url = `${s.endpoint}${QUERY[name] ?? ''}`
  const res = await cp.pay(url) // pays the 402; autoFeedback is off, we rate explicitly below
  const tx = res.payment?.txHash
  if (!res.ok || !tx) { say(`    ✖ ${name}: HTTP ${res.status}, settlement tx ${tx ?? 'missing'}; not rating`); return }
  const rated = await cp.giveFeedback(s.agentId, score, { endpoint: s.endpoint, tag, paymentTx: tx, waitConfirm: true })
  say(`    ${name.padEnd(13)} paid ${tx.slice(0, 12)}…  rated ${String(score).padStart(3)}  ${rated.slice(0, 12)}…`)
  ratingsLog.push({ name, score, paymentTx: tx, feedbackTx: rated })
}

for (const [i, w] of wallets.entries()) {
  say(`wallet ${i + 1}/${wallets.length} ${w.address}`)
  const cp = new ChainPe({ privateKey: w.key, network: 'avalanche', maxPerCall: '0.05' })
  for (let n = 0; n < CALLS_GOOD; n++) {
    await payAndRate(cp, 'weather', GOOD[(i + n) % GOOD.length], 'seed-good')
    await payAndRate(cp, 'summarize', GOOD[(i + n + 1) % GOOD.length], 'seed-good')
  }
  for (let n = 0; n < CALLS_CHEAP; n++) await payAndRate(cp, 'cheap-weather', BAD[(i + n) % BAD.length], 'seed-bad')
}

say(`\nFresh wallets: ${UNPAID_TOTAL} unpaid ratings of 100 on cheap-weather (they never pay)`)
const funder = privateKeyToAccount(funderKey)
const funderWallet = createWalletClient({ account: funder, chain: avalanche, transport: http(RPC) })
const fresh = Array.from({ length: UNPAID_RATERS }, () => { const k = generatePrivateKey(); return { key: k, address: privateKeyToAccount(k).address } })
// Saved so you can sweep the leftover AVAX. Never commit this file (it is gitignored).
const savePath = fileURLToPath(new URL('./.seed-unpaid-wallets.json', import.meta.url))
writeFileSync(savePath, JSON.stringify(fresh, null, 2), { mode: 0o600 })
say(`  keys saved to ${savePath}`)
for (const f of fresh) {
  const hash = await funderWallet.sendTransaction({ to: f.address, value: parseEther(UNPAID_WALLET_AVAX) })
  await pub.waitForTransactionReceipt({ hash })
  const cp = new ChainPe({ privateKey: f.key, network: 'avalanche' })
  for (let n = 0; n < UNPAID_PER_WALLET; n++) {
    const tx = await cp.giveFeedback(svc['cheap-weather'].agentId, 100, { endpoint: svc['cheap-weather'].endpoint, tag: 'unpaid-demo', waitConfirm: true }) // no paymentTx
    say(`  ${f.address}  rated 100 unpaid  ${tx.slice(0, 12)}…`)
  }
}

say(`\nDone: ${ratingsLog.length} paid ratings + ${UNPAID_TOTAL} unpaid. chainpe-cloud verifies each paid one within a minute or two.`)
say('Check the result (waits for the indexer):')
for (let attempt = 0; attempt < 18; attempt++) {
  const cw = (await services()).find((x) => x.name === 'cheap-weather')
  say(`  cheap-weather: paid ${cw?.paidScore ?? '-'} (${cw?.paidReviews ?? 0} verified), raw ${cw?.rawScore ?? '-'} (${cw?.rawReviews ?? 0} total)`)
  if (cw && cw.paidReviews >= wallets.length * CALLS_CHEAP && cw.rawReviews >= wallets.length * CALLS_CHEAP + UNPAID_TOTAL) break
  await sleep(20_000)
}
say('Then run: node e2e/seed-reputation.mjs --check')
