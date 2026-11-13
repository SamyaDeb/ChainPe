/**
 * Investment Orchestrator — autonomous AVAX fund manager on ChainPe.
 *
 * Discovers and HIRES four specialized agents sequentially, paying each in USDC:
 *   1. avax-price-agent   → live AVAX price + Avalanche DeFi TVL
 *   2. avax-news-agent    → latest Avalanche ecosystem news + sentiment
 *   3. avax-analysis-agent → Claude investment thesis: BUY/SELL/HOLD + targets
 *   4. avax-dex-agent     → execute swap on Trader Joe Fuji (if BUY/SELL)
 *
 * Flags:
 *   --sim       simulation only — no real swaps (default: live)
 *   --cycles N  run N investment cycles (default: 1)
 *   --amount X  USDC/AVAX amount per trade (default: 1.0)
 *
 * Run:
 *   CHAINPE_PRIVATE_KEY=0x... node investment-orchestrator.mjs
 *   CHAINPE_PRIVATE_KEY=0x... node investment-orchestrator.mjs --cycles 3 --amount 0.5
 *   CHAINPE_PRIVATE_KEY=0x... node investment-orchestrator.mjs --sim   # simulation only
 */
import 'dotenv/config'
import { ChainPe } from '@chainpe/sdk'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const LIVE = !args.includes('--sim')
const CYCLES = Number(args[args.indexOf('--cycles') + 1] ?? 1) || 1
const TRADE_AMOUNT = args[args.indexOf('--amount') + 1] ?? '1.0'

const privateKey = process.env.CHAINPE_PRIVATE_KEY || process.env.BUYER_KEY
if (!privateKey) {
  console.error('Set CHAINPE_PRIVATE_KEY (the buyer wallet, needs Fuji USDC).')
  process.exit(1)
}

const network = process.env.CHAINPE_NETWORK || 'fuji'
const cp = new ChainPe({ privateKey, network, autoFeedback: true, maxPerCall: '0.20' })

// ── Helpers ───────────────────────────────────────────────────────────────────

function header(t) {
  const line = '─'.repeat(64)
  console.log(`\n${line}\n${t}\n${line}`)
}

function paid(label, payment) {
  if (payment) {
    console.log(`  💸 ${label}: paid ${payment.amount} USDC → ${payment.recipient}`)
    if (payment.txHash) console.log(`     tx: https://testnet.snowtrace.io/tx/${payment.txHash}`)
  }
}

function rep(reputation) {
  if (reputation) {
    console.log(`  ⭐ rated agent ${reputation.agentId} +${reputation.score}  tx ${reputation.txHash}`)
  }
}

function pickAgent(services, tags, envUrl, label) {
  if (envUrl) return { name: `${label} (override)`, endpoint: envUrl, reputation: null }
  const match = services.find((s) => s.tags?.some((t) => tags.includes(t.toLowerCase())))
  if (!match) {
    console.error(
      `  ✗ No ${label} found on marketplace (tags: ${tags.join(', ')}). ` +
      `Is it running and registered? See .env.example.`
    )
    return null
  }
  return match
}

function stars(rep) {
  return rep?.score != null ? `⭐ ${rep.score} (${rep.count} ratings)` : 'unrated'
}

// ── Portfolio state (in-memory across cycles) ─────────────────────────────────

const portfolio = {
  usdcBalance: Number(process.env.PORTFOLIO_USDC ?? '10.0'),
  avaxAmount: Number(process.env.PORTFOLIO_AVAX ?? '0'),
  trades: [],
  totalPaid: 0,
}

// ── Main investment loop ──────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════')
console.log('  ChainPe Investment Orchestrator — Avalanche Fuji Testnet')
console.log('════════════════════════════════════════════════════════════════')
console.log(`  Buyer wallet : ${cp.getAddress()}`)
const bal = await cp.balance()
console.log(`  USDC balance : ${bal.usdc} USDC`)
console.log(`  AVAX balance : ${bal.avax} AVAX`)
console.log(`  Mode         : ${LIVE ? '🔴 LIVE (real swaps)' : '🟡 SIMULATION (no real swaps)'}`)
console.log(`  Cycles       : ${CYCLES}`)
console.log(`  Trade amount : ${TRADE_AMOUNT} per trade`)
console.log(`  Network      : ${network}`)

// Discover all agents once at the start
header('DISCOVERY: Finding agents on ChainPe marketplace')
const allServices = await cp.discover()
console.log(`  Found ${allServices.length} service(s) on marketplace, ranked by ⭐ reputation.`)
for (const s of allServices.slice(0, 8)) {
  console.log(`  • ${s.name.padEnd(28)} $${s.pricePerRequest}/call  ${stars(s.reputation)}`)
}

const priceAgent    = pickAgent(allServices, ['price', 'defi'],   process.env.PRICE_URL,    'Price Agent')
const newsAgent     = pickAgent(allServices, ['avalanche'],        process.env.NEWS_URL,     'News Agent')
const analysisAgent = pickAgent(allServices, ['analysis'],         process.env.ANALYSIS_URL, 'Analysis Agent')
const dexAgent      = pickAgent(allServices, ['dex', 'swap'],      process.env.DEX_URL,      'DEX Agent')

if (!priceAgent || !newsAgent || !analysisAgent) {
  console.error('\n  ✗ Missing required agents. Start them all, then register with register-seller.mjs')
  process.exit(1)
}

// ── Investment cycles ─────────────────────────────────────────────────────────

for (let cycle = 1; cycle <= CYCLES; cycle++) {
  header(`CYCLE ${cycle}/${CYCLES} — ${new Date().toISOString()}`)
  console.log(`  Portfolio: ${portfolio.avaxAmount.toFixed(4)} AVAX + $${portfolio.usdcBalance.toFixed(2)} USDC`)

  let priceData = null
  let newsData = null
  let analysis = null

  // ── Step 1: Fetch live AVAX price ──────────────────────────────────────────
  console.log(`\n[1/4] Hiring ${priceAgent.name}  [${stars(priceAgent.reputation)}]`)
  try {
    const res = await cp.pay(`${priceAgent.endpoint}/price`)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
    priceData = res.data
    paid('Price data', res.payment)
    rep(res.reputation)
    portfolio.totalPaid += Number(res.payment?.amount ?? 0)

    if (priceData.avax) {
      console.log(
        `  AVAX: $${priceData.avax.usd}` +
        `  24h: ${priceData.avax.change24h?.toFixed(2)}%` +
        `  7d: ${priceData.avax.change7d?.toFixed(2)}%`
      )
      console.log(
        `  Volume: $${priceData.avax.volume24h ? (priceData.avax.volume24h / 1e6).toFixed(0) + 'M' : '?'}` +
        `  TVL: $${priceData.avalancheTvl ? (priceData.avalancheTvl / 1e9).toFixed(2) + 'B' : '?'}`
      )
    }
  } catch (err) {
    console.error(`  ✗ Price agent failed: ${err.message}`)
  }

  // ── Step 2: Fetch Avalanche news ───────────────────────────────────────────
  console.log(`\n[2/4] Hiring ${newsAgent.name}  [${stars(newsAgent.reputation)}]`)
  try {
    const res = await cp.pay(`${newsAgent.endpoint}/news`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: 8 }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
    newsData = res.data
    paid('News digest', res.payment)
    rep(res.reputation)
    portfolio.totalPaid += Number(res.payment?.amount ?? 0)

    if (newsData) {
      console.log(`  Sentiment : ${newsData.sentiment?.toUpperCase()}`)
      console.log(`  Headline  : ${newsData.headline}`)
      for (const kd of (newsData.keyDevelopments ?? []).slice(0, 3)) {
        console.log(`  • ${kd}`)
      }
    }
  } catch (err) {
    console.error(`  ✗ News agent failed: ${err.message}`)
  }

  // ── Step 3: Claude investment analysis ─────────────────────────────────────
  if (priceData || newsData) {
    console.log(`\n[3/4] Hiring ${analysisAgent.name}  [${stars(analysisAgent.reputation)}]`)
    try {
      const res = await cp.pay(`${analysisAgent.endpoint}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ price: priceData, news: newsData, portfolio }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
      analysis = res.data
      paid('Investment analysis', res.payment)
      rep(res.reputation)
      portfolio.totalPaid += Number(res.payment?.amount ?? 0)

      const emoji = { BUY: '🟢', SELL: '🔴', HOLD: '🟡' }[analysis.action] ?? '⚪'
      console.log(`\n  ${emoji} RECOMMENDATION: ${analysis.action}  (confidence: ${analysis.confidence}%)`)
      console.log(`  Rationale  : ${analysis.rationale}`)
      if (analysis.targetEntryUsd) console.log(`  Entry      : $${analysis.targetEntryUsd}`)
      if (analysis.targetExitUsd)  console.log(`  Target     : $${analysis.targetExitUsd}`)
      if (analysis.stopLossUsd)    console.log(`  Stop-loss  : $${analysis.stopLossUsd}`)
      console.log(`  Position   : ${analysis.positionSizePercent}% of portfolio  (${analysis.timeHorizon})`)
      for (const sig of (analysis.technicalSignals ?? []).slice(0, 3)) console.log(`  Signal     : ${sig}`)
      for (const risk of (analysis.keyRisks ?? [])) console.log(`  Risk       : ${risk}`)
    } catch (err) {
      console.error(`  ✗ Analysis agent failed: ${err.message}`)
    }
  }

  // ── Step 4: Execute trade on DEX ───────────────────────────────────────────
  const shouldTrade = analysis && (analysis.action === 'BUY' || analysis.action === 'SELL')

  if (!dexAgent) {
    console.log('\n[4/4] DEX Agent not available — skipping execution.')
  } else if (!shouldTrade) {
    console.log(`\n[4/4] Analysis says HOLD — no trade this cycle.`)
  } else {
    const isBuy = analysis.action === 'BUY'
    const fromToken = isBuy ? 'USDC' : 'WAVAX'
    const toToken   = isBuy ? 'WAVAX' : 'USDC'
    const swapAmount = isBuy
      ? (portfolio.usdcBalance * analysis.positionSizePercent / 100).toFixed(2)
      : (portfolio.avaxAmount  * analysis.positionSizePercent / 100).toFixed(4)

    console.log(`\n[4/4] Hiring ${dexAgent.name}  [${stars(dexAgent.reputation)}]`)
    console.log(`  Action: ${analysis.action} ${swapAmount} ${fromToken} → ${toToken}${LIVE ? '' : '  (simulation)'}`)

    try {
      const res = await cp.pay(`${dexAgent.endpoint}/swap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromToken,
          toToken,
          amountIn: swapAmount,
          slippagePct: 1.0,
          live: LIVE,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.data)}`)
      const swap = res.data
      paid('DEX swap', res.payment)
      rep(res.reputation)
      portfolio.totalPaid += Number(res.payment?.amount ?? 0)

      console.log(`  Mode : ${swap.mode?.toUpperCase()}`)
      if (swap.swap) {
        console.log(`  From : ${swap.swap.from?.amount} ${swap.swap.from?.token}`)
        console.log(`  To   : ${swap.swap.to?.estimatedAmount ?? swap.swap.to?.amount} ${swap.swap.to?.token}`)
        console.log(`  Rate : ${swap.swap.rate?.toFixed(6)}`)
      }
      if (swap.tx) {
        console.log(`  TX   : ${swap.tx.explorerUrl}`)
        console.log(`  Status: ${swap.tx.status}`)
      }

      // Update in-memory portfolio (simulated P&L tracking)
      const outAmt = Number(swap.swap?.to?.estimatedAmount ?? swap.swap?.to?.amount ?? 0)
      if (isBuy && outAmt > 0) {
        portfolio.usdcBalance  -= Number(swapAmount)
        portfolio.avaxAmount   += outAmt
      } else if (!isBuy && outAmt > 0) {
        portfolio.avaxAmount   -= Number(swapAmount)
        portfolio.usdcBalance  += outAmt
      }

      portfolio.trades.push({
        cycle,
        action: analysis.action,
        from: `${swapAmount} ${fromToken}`,
        to: `${outAmt} ${toToken}`,
        rate: swap.swap?.rate,
        live: LIVE,
        txHash: swap.tx?.swapTxHash ?? null,
      })
    } catch (err) {
      console.error(`  ✗ DEX agent failed: ${err.message}`)
    }
  }

  // Brief pause between cycles to avoid rate-limit on free APIs
  if (cycle < CYCLES) {
    console.log('\n  ⏳ Waiting 5s before next cycle...')
    await new Promise((r) => setTimeout(r, 5000))
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

header('INVESTMENT SESSION SUMMARY')
console.log(`  Final portfolio:`)
console.log(`    AVAX  : ${portfolio.avaxAmount.toFixed(4)} AVAX`)
console.log(`    USDC  : $${portfolio.usdcBalance.toFixed(2)}`)
console.log(`  Total service fees paid: $${portfolio.totalPaid.toFixed(4)} USDC`)
console.log(`  Trades executed        : ${portfolio.trades.length}`)
for (const t of portfolio.trades) {
  const live = t.live ? '🔴 LIVE' : '🟡 SIM'
  console.log(`    [Cycle ${t.cycle}] ${t.action} ${t.from} → ${t.to}  ${live}`)
  if (t.txHash) console.log(`      tx: https://testnet.snowtrace.io/tx/${t.txHash}`)
}
console.log('\n  Agents that earned USDC this session:')
console.log('    ✓ AVAX Price Agent  (real-time market data)')
console.log('    ✓ AVAX News Agent   (ecosystem news + LLM synthesis)')
console.log('    ✓ AVAX Analysis Agent (Claude investment thesis)')
if (portfolio.trades.length > 0) console.log('    ✓ AVAX DEX Agent    (Trader Joe Fuji swap execution)')
console.log()
