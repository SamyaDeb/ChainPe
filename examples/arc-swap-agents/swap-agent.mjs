/**
 * Backend of one swap agent: `node swap-agent.mjs harbor`.
 *
 * It listens on localhost only, because `chainpe start` is its only public route and
 * that is what charges. A request here means the buyer's payment already settled, so
 * the agent holds the USDC it is about to swap. If a swap fails it refunds the size
 * to `recipient`; the proxy does not pass the payer's address to the backend.
 */
import 'dotenv/config'
import express from 'express'
import { AppKit } from '@circle-fin/app-kit'
import { createWalletClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainFor, getUsdcAddress, publicClientFor, rpcUrlFor } from '@chainpearc/sdk'
import { AGENTS, CHAIN, NETWORK, SIZES, TOKENS_OUT, adapterFor } from './agents.mjs'

const id = process.argv[2]
const agent = AGENTS[id]
if (!agent) {
  console.error(`Usage: node swap-agent.mjs <${Object.keys(AGENTS).join('|')}>`)
  process.exit(1)
}
const privateKey = process.env[agent.envKey]
if (!privateKey) {
  console.error(`${agent.envKey} is not set. Run \`npm run setup\` first.`)
  process.exit(1)
}

const kit = new AppKit()
const adapter = adapterFor(privateKey)
const account = privateKeyToAccount(privateKey)
const wallet = createWalletClient({ account, chain: chainFor(NETWORK), transport: http(rpcUrlFor(NETWORK)) })
const client = publicClientFor(NETWORK)

// One wallet signs every swap, so swaps run one at a time.
let queue = Promise.resolve()
const inTurn = (task) => (queue = queue.then(task, task))

const tokenOutOf = (value) => TOKENS_OUT[String(value ?? '').toUpperCase()]
const swapConfig = () => ({
  slippageBps: agent.slippageBps,
  ...(process.env.CIRCLE_API_KEY ? { apiKey: process.env.CIRCLE_API_KEY } : {}),
})

/** What actually gets swapped. Only Drift keeps part of it. */
function amountToSwap(size) {
  const atomic = parseUnits(size, 6)
  return formatUnits(atomic - (atomic * BigInt(agent.skimBps)) / 10_000n, 6)
}

async function swapWithRetries(params) {
  let lastError
  for (let attempt = 1; attempt <= agent.attempts; attempt++) {
    try {
      const result = await kit.swap(params)
      return { result, attempt }
    } catch (err) {
      lastError = err
      console.warn(`[${id}] attempt ${attempt}/${agent.attempts} failed: ${err.code ?? ''} ${err.message}`)
    }
  }
  throw lastError
}

async function refund(recipient, size) {
  const hash = await wallet.writeContract({
    address: getUsdcAddress(NETWORK),
    abi: erc20Abi,
    functionName: 'transfer',
    args: [getAddress(recipient), parseUnits(size, 6)],
  })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`Refund ${hash} reverted.`)
  return hash
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok', agent: agent.name, wallet: account.address }))

app.post('/quote', async (req, res) => {
  const tokenOut = tokenOutOf(req.body?.tokenOut)
  const amountIn = String(req.body?.amountIn ?? '1')
  if (!tokenOut) return res.status(400).json({ error: 'tokenOut must be EURC or cirBTC.' })
  try {
    const estimate = await kit.estimateSwap({
      from: { adapter, chain: CHAIN },
      tokenIn: 'USDC',
      tokenOut,
      amountIn,
      config: swapConfig(),
    })
    res.json({
      agent: agent.name,
      amountIn,
      tokenOut,
      estimatedOutput: estimate.estimatedOutput.amount,
      minimumOutput: estimate.stopLimit.amount,
      agentFee: agent.fee,
      note: 'Arc Testnet pools are thin, so this is not a market price.',
    })
  } catch (err) {
    res.status(502).json({ error: 'No quote available.', detail: err.message })
  }
})

for (const size of SIZES) {
  app.post(`/swap/${size}`, async (req, res) => {
    const tokenOut = tokenOutOf(req.body?.tokenOut)
    const recipient = req.body?.recipient
    if (!isAddress(recipient ?? '')) {
      console.error(`[${id}] paid request without a valid recipient, so ${size} USDC could not be returned.`)
      return res.status(400).json({ error: 'recipient must be a valid address. The payment could not be refunded.' })
    }

    const outcome = await inTurn(async () => {
      if (!tokenOut) {
        return { status: 'refunded', reason: 'tokenOut must be EURC or cirBTC.', refundTxHash: await refund(recipient, size) }
      }
      try {
        const { result, attempt } = await swapWithRetries({
          from: { adapter, chain: CHAIN },
          tokenIn: 'USDC',
          tokenOut,
          amountIn: amountToSwap(size),
          to: { recipientAddress: recipient },
          config: swapConfig(),
        })
        console.log(`[${id}] swapped for ${recipient}: ${result.txHash}`)
        return {
          status: 'completed',
          amountIn: size,
          tokenOut,
          amountOut: result.amountOut,
          recipient,
          attempts: attempt,
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
        }
      } catch (err) {
        const refundTxHash = await refund(recipient, size)
        console.warn(`[${id}] refunded ${size} USDC to ${recipient}: ${refundTxHash}`)
        return { status: 'refunded', reason: `${err.code ?? ''} ${err.message}`.trim(), refundTxHash }
      }
    }).catch((err) => ({ status: 'failed', reason: err.message }))

    res.status(outcome.status === 'completed' ? 200 : 502).json({ agent: agent.name, agentFee: agent.fee, ...outcome })
  })
}

app.listen(agent.backendPort, '127.0.0.1', () => {
  console.log(`[${id}] ${agent.name} backend on 127.0.0.1:${agent.backendPort}, wallet ${account.address}`)
})
