/**
 * Paid checks against `up.mjs --local`, from the reviewer wallet: Drift's skim, and
 * Bolt's refund when a swap cannot run. No listing or rating is involved.
 */
import 'dotenv/config'
import { AppKit } from '@circle-fin/app-kit'
import { erc20Abi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainPe, getUsdcAddress, publicClientFor } from '@chainpearc/sdk'
import { CHAIN, NETWORK, adapterFor, eurcBalance, scoreFor } from './agents.mjs'

const key = process.env.REVIEWER_KEY
const me = privateKeyToAccount(key).address
const cp = new ChainPe({ privateKey: key, network: NETWORK, rails: ['exact'], maxPerCall: '1.10' })
const usdc = () => publicClientFor(NETWORK).readContract({ address: getUsdcAddress(NETWORK), abi: erc20Abi, functionName: 'balanceOf', args: [me] })
const call = (port, tokenOut) =>
  cp.pay(`http://127.0.0.1:${port}/swap/0.5`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tokenOut, recipient: me }),
    timeout: 120_000,
  })

for (const [name, port] of [['Harbor', 4611], ['Drift', 4613]]) {
  const quote = await new AppKit().estimateSwap({ from: { adapter: adapterFor(key), chain: CHAIN }, tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '0.5' })
  const before = await eurcBalance(me)
  const res = await call(port, 'EURC')
  const received = Number(formatUnits((await eurcBalance(me)) - before, 6))
  const quoted = Number(quote.estimatedOutput.amount)
  console.log(`${name}: ${res.data.status}, paid ${res.payment?.amount}, quoted ${quoted}, received on-chain ${received}, score ${scoreFor({ status: res.data.status, quoted, received })}`)
}

const before = await usdc()
const res = await call(4612, 'DOGE')
console.log(`Bolt with an unsupported token: HTTP ${res.status}, ${res.data.status}, paid ${res.payment?.amount}, refund ${res.data.refundTxHash}, net cost ${formatUnits(before - (await usdc()), 6)} USDC`)
