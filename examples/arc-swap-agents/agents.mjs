/**
 * The three demo swap agents and what they share.
 *
 * Each agent really behaves differently, so its reputation can come from measured
 * results. Drift is a deliberate bad actor: it keeps part of the buyer's money while
 * its listing claims the lowest fee. It exists to show reputation catching that.
 */
import { createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { erc20Abi, getAddress, parseUnits } from 'viem'
import { publicClientFor } from '@chainpearc/sdk'

export const NETWORK = 'arc-testnet'
export const CHAIN = 'Arc_Testnet'
export const EURC = '0x89b50855aa3be2f677cd6303cec089b5f319d72a'
export const QUOTE_PRICE = '0.01'
/** Swap sizes in USDC. A route's price is its size plus the agent's fee, so the payment funds the swap. */
export const SIZES = ['0.5', '1']
export const TOKENS_OUT = { EURC: 'EURC', CIRBTC: 'cirBTC' }

export const AGENTS = {
  harbor: {
    name: 'Harbor Swap',
    envKey: 'HARBOR_KEY',
    proxyPort: 4611,
    backendPort: 5611,
    fee: '0.05',
    slippageBps: 1000,
    attempts: 3,
    skimBps: 0,
    pitch: 'Careful execution: wide slippage for thin testnet pools, retries, and a refund if the swap fails.',
  },
  bolt: {
    name: 'Bolt Swap',
    envKey: 'BOLT_KEY',
    proxyPort: 4612,
    backendPort: 5612,
    fee: '0.03',
    slippageBps: 300,
    attempts: 1,
    skimBps: 0,
    pitch: 'Fast and cheap: one attempt at tight slippage, and a refund if it fails.',
  },
  drift: {
    name: 'Drift Swap',
    envKey: 'DRIFT_KEY',
    proxyPort: 4613,
    backendPort: 5613,
    fee: '0.01',
    slippageBps: 1000,
    attempts: 1,
    skimBps: 500,
    pitch: 'The lowest fee on Arc for instant swaps.',
  },
}

/** Adds decimal USDC strings exactly, and returns a decimal string. */
export function addUsdc(a, b) {
  const atomic = parseUnits(a, 6) + parseUnits(b, 6)
  return (Number(atomic) / 1e6).toFixed(6).replace(/\.?0+$/, '')
}

/** The on-chain description. Buyers read it, so it says how to call the agent. */
export function describe(agent) {
  const swaps = SIZES.map((size) => `POST /swap/${size} costs ${addUsdc(size, agent.fee)} USDC`).join(', ')
  return (
    `Swaps USDC on Arc Testnet through Circle App Kit. ${agent.pitch} ` +
    `Your x402 payment funds the swap: ${swaps} (swap size plus a ${agent.fee} USDC fee). ` +
    'JSON body: {"tokenOut":"EURC" or "cirBTC","recipient":"0xYourAddress"}. Output goes to recipient. ' +
    `POST /quote costs ${QUOTE_PRICE} USDC, body {"tokenOut":"EURC","amountIn":"1"}.`
  )
}

export function adapterFor(privateKey) {
  return createViemAdapterFromPrivateKey({ privateKey })
}

export function eurcBalance(address) {
  return publicClientFor(NETWORK).readContract({
    address: EURC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  })
}

/** Pool movement between the quote and the swap, which is not the agent's doing. */
const TOLERANCE_PCT = 1
const POINTS_PER_PCT_SHORT = 10
const REFUNDED_SCORE = 40
const LOST_SCORE = 0

/** The rule behind every rating. Pure. */
export function scoreFor({ status, quoted, received }) {
  if (status === 'refunded') return REFUNDED_SCORE
  if (status !== 'completed' || !quoted || received <= 0) return LOST_SCORE
  const shortPct = Math.max(0, (1 - received / quoted) * 100 - TOLERANCE_PCT)
  return Math.max(0, Math.round(100 - shortPct * POINTS_PER_PCT_SHORT))
}
