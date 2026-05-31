/**
 * Tinyman DEX swaps for Algorand Testnet.
 *
 * Allows the agent to autonomously swap between ALGO and USDC (or any ASA pair)
 * on the Tinyman v2 testnet pool — useful when the agent needs USDC to make an
 * x402 payment but only holds ALGO.
 *
 * NOTE: Tinyman v2 on testnet uses the same SDK but against testnet pools.
 * Pool liquidity on testnet is limited — use small amounts for testing.
 */

import { z } from 'zod'
import algosdk from 'algosdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'

const ALGOD_URLS: Record<string, string> = {
  algorand: 'https://mainnet-api.algonode.cloud',
  'algorand-testnet': 'https://testnet-api.algonode.cloud'
}

const USDC_ASA: Record<string, number> = {
  algorand: 31566704,
  'algorand-testnet': 10458941
}

// Asset IDs for ALGO (native token is always 0 in algosdk)
const ALGO_ASA_ID = 0

function microAlgoToAlgo(microAlgo: bigint): string {
  const whole = microAlgo / 1_000_000n
  const frac = microAlgo % 1_000_000n
  return `${whole}.${frac.toString().padStart(6, '0')}`
}

function microUsdcToUsdc(mu: bigint): string {
  const whole = mu / 1_000_000n
  const frac = mu % 1_000_000n
  return `${whole}.${frac.toString().padStart(6, '0')}`
}

function decimalToMicro(amount: string): bigint {
  const parts = amount.split('.')
  const whole = parts[0] || '0'
  const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6)
  return BigInt(whole) * 1_000_000n + BigInt(frac)
}

/**
 * Get pool reserves from Tinyman v2 indexer.
 * Returns { asset1Reserve, asset2Reserve } where asset1 < asset2 always.
 */
async function getPoolReserves(
  network: string,
  assetIn: number,
  assetOut: number
): Promise<{ asset1Id: number; asset2Id: number; asset1Reserve: bigint; asset2Reserve: bigint; appId: number }> {
  // Tinyman v2 app IDs
  const TINYMAN_APP_IDS: Record<string, number> = {
    algorand: 1002541853,
    'algorand-testnet': 148607000
  }

  const appId = TINYMAN_APP_IDS[network]
  if (!appId) throw new Error(`No Tinyman app ID configured for network: ${network}`)

  // Derive the pool address (escrow) from the two assets
  const asset1Id = Math.min(assetIn, assetOut)
  const asset2Id = Math.max(assetIn, assetOut)

  // Pool account is derived deterministically
  const poolLogicSig = algosdk.getApplicationAddress(appId)

  // Hit the indexer for pool state
  const indexerUrl =
    network === 'algorand-testnet'
      ? 'https://testnet-idx.algonode.cloud'
      : 'https://mainnet-idx.algonode.cloud'

  const resp = await fetch(
    `${indexerUrl}/v2/accounts/${poolLogicSig}/apps-local-state?application-id=${appId}`
  )
  if (!resp.ok) throw new Error(`Indexer error: ${resp.status}`)
  await resp.json() // drain response

  // We can't directly query a specific pool this way — use Tinyman's REST API instead
  const tinymanApiBase =
    network === 'algorand-testnet'
      ? 'https://testnet.analytics.tinyman.org'
      : 'https://mainnet.analytics.tinyman.org'

  const poolResp = await fetch(
    `${tinymanApiBase}/api/v1/pools/${asset1Id}-${asset2Id}/`
  )
  if (!poolResp.ok) {
    throw new Error(
      `Pool not found for assets ${asset1Id}/${asset2Id} on ${network}. ` +
      `Pool may not exist on testnet. Try using 0 (ALGO) and ${USDC_ASA[network]} (USDC).`
    )
  }
  const poolData = (await poolResp.json()) as any

  return {
    asset1Id,
    asset2Id,
    asset1Reserve: BigInt(poolData.asset_1_reserves ?? 0),
    asset2Reserve: BigInt(poolData.asset_2_reserves ?? 0),
    appId
  }
}

/**
 * Constant-product AMM formula: given input amount and reserves, compute output.
 * fee = 0.3% (997/1000)
 */
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const amountInWithFee = amountIn * 997n
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 1000n + amountInWithFee
  return numerator / denominator
}

/**
 * Constant-product AMM: given desired output amount, compute required input.
 */
function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const numerator = reserveIn * amountOut * 1000n
  const denominator = (reserveOut - amountOut) * 997n
  return numerator / denominator + 1n
}

// ─── Tool Registration ────────────────────────────────────────────────────────

export function registerTinymanSwaps(
  server: McpServer,
  config: AppConfig
): void {
  // ─── Fixed Input Swap ───────────────────────────────────────────────────────
  server.tool(
    'tinyman_swap_fixed_input',
    'Swap a fixed input amount of one Algorand asset for another on Tinyman DEX (testnet). ' +
      'Use this when you want to spend exactly X amount. ' +
      'Example: swap 1 ALGO for as much USDC as possible. ' +
      'Asset ID 0 = ALGO (native). USDC testnet ASA ID = 10458941.',
    {
      assetInId: z
        .number()
        .int()
        .describe('Asset ID to spend. Use 0 for native ALGO, 10458941 for USDC on testnet.'),
      assetOutId: z
        .number()
        .int()
        .describe('Asset ID to receive. Use 0 for native ALGO, 10458941 for USDC on testnet.'),
      amountIn: z
        .string()
        .describe('Exact amount to spend as decimal string, e.g. "1.5" for 1.5 ALGO'),
      slippagePct: z
        .number()
        .default(1)
        .describe('Slippage tolerance in percent (default 1%). Lower = stricter.'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Network (default: algorand-testnet)')
    },
    async ({ assetInId, assetOutId, amountIn, slippagePct, network }) => {
      if (!config.algorandMnemonic) {
        return {
          content: [{ type: 'text' as const, text: 'No Algorand wallet configured. Set ALGORAND_MNEMONIC.' }],
          isError: true
        }
      }

      try {
        const algodUrl = ALGOD_URLS[network]
        const algodClient = new algosdk.Algodv2('', algodUrl, '')
        const { sk, addr } = algosdk.mnemonicToSecretKey(config.algorandMnemonic)
        const senderAddress = algosdk.encodeAddress(addr.publicKey)

        const amountInMicro = decimalToMicro(amountIn)
        if (amountInMicro <= 0n) throw new Error('Amount must be > 0')

        // Get pool info
        const pool = await getPoolReserves(network, assetInId, assetOutId)

        // Determine which is asset1 and which is asset2 in the pool
        const isInAsset1 = assetInId === pool.asset1Id
        const reserveIn = isInAsset1 ? pool.asset1Reserve : pool.asset2Reserve
        const reserveOut = isInAsset1 ? pool.asset2Reserve : pool.asset1Reserve

        // Compute output
        const amountOutMicro = getAmountOut(amountInMicro, reserveIn, reserveOut)
        const minAmountOut = (amountOutMicro * BigInt(Math.floor((100 - slippagePct) * 10))) / 1000n

        const params = await algodClient.getTransactionParams().do()

        const transactions: algosdk.Transaction[] = []

        // 1. Input asset transfer (or pay for ALGO)
        if (assetInId === ALGO_ASA_ID) {
          transactions.push(
            algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk.getApplicationAddress(pool.appId),
              amount: amountInMicro,
              suggestedParams: params
            })
          )
        } else {
          transactions.push(
            algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk.getApplicationAddress(pool.appId),
              amount: amountInMicro,
              assetIndex: assetInId,
              suggestedParams: params
            })
          )
        }

        // 2. App call to execute swap
        transactions.push(
          algosdk.makeApplicationNoOpTxnFromObject({
            sender: senderAddress,
            appIndex: pool.appId,
            appArgs: [
              new TextEncoder().encode('swap'),
              algosdk.encodeUint64(minAmountOut)
            ],
            foreignAssets: [assetInId === ALGO_ASA_ID ? assetOutId : assetInId, assetOutId === ALGO_ASA_ID ? assetInId : assetOutId].filter((v, i, a) => a.indexOf(v) === i && v !== 0),
            suggestedParams: params
          })
        )

        algosdk.assignGroupID(transactions)
        const signedTxns = transactions.map(txn => algosdk.signTransaction(txn, sk).blob)
        const txnBlob = Buffer.concat(signedTxns.map(s => Buffer.from(s)))
        const { txid } = await algodClient.sendRawTransaction(txnBlob).do()
        await algosdk.waitForConfirmation(algodClient, txid, 5)

        const explorerUrl =
          network === 'algorand-testnet'
            ? `https://testnet.explorer.perawallet.app/tx/${txid}`
            : `https://explorer.perawallet.app/tx/${txid}`

        const inLabel = assetInId === ALGO_ASA_ID ? 'ALGO' : `ASA#${assetInId}`
        const outLabel = assetOutId === ALGO_ASA_ID ? 'ALGO' : `ASA#${assetOutId}`

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  swap: `${amountIn} ${inLabel} → ~${microUsdcToUsdc(amountOutMicro)} ${outLabel}`,
                  amountIn: `${amountIn} ${inLabel}`,
                  estimatedAmountOut: `${microUsdcToUsdc(amountOutMicro)} ${outLabel}`,
                  minAmountOut: `${microUsdcToUsdc(minAmountOut)} ${outLabel}`,
                  network,
                  explorerUrl
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Swap failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )

  // ─── Fixed Output Swap ──────────────────────────────────────────────────────
  server.tool(
    'tinyman_swap_fixed_output',
    'Swap to receive an exact output amount of one Algorand asset from another on Tinyman DEX (testnet). ' +
      'Use this when you need exactly X USDC for an x402 payment. ' +
      'Example: get exactly 1.05 USDC, spend as little ALGO as possible. ' +
      'Asset ID 0 = ALGO (native). USDC testnet ASA ID = 10458941.',
    {
      assetInId: z
        .number()
        .int()
        .describe('Asset ID to spend. Use 0 for native ALGO, 10458941 for USDC on testnet.'),
      assetOutId: z
        .number()
        .int()
        .describe('Asset ID to receive. Use 0 for native ALGO, 10458941 for USDC on testnet.'),
      amountOut: z
        .string()
        .describe('Exact amount to receive as decimal, e.g. "1.05" for 1.05 USDC'),
      slippagePct: z
        .number()
        .default(1)
        .describe('Slippage tolerance in percent (default 1%). Higher = less likely to fail.'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Network (default: algorand-testnet)')
    },
    async ({ assetInId, assetOutId, amountOut, slippagePct, network }) => {
      if (!config.algorandMnemonic) {
        return {
          content: [{ type: 'text' as const, text: 'No Algorand wallet configured. Set ALGORAND_MNEMONIC.' }],
          isError: true
        }
      }

      try {
        const algodUrl = ALGOD_URLS[network]
        const algodClient = new algosdk.Algodv2('', algodUrl, '')
        const { sk, addr } = algosdk.mnemonicToSecretKey(config.algorandMnemonic)
        const senderAddress = algosdk.encodeAddress(addr.publicKey)

        const amountOutMicro = decimalToMicro(amountOut)
        if (amountOutMicro <= 0n) throw new Error('Amount must be > 0')

        const pool = await getPoolReserves(network, assetInId, assetOutId)

        const isInAsset1 = assetInId === pool.asset1Id
        const reserveIn = isInAsset1 ? pool.asset1Reserve : pool.asset2Reserve
        const reserveOut = isInAsset1 ? pool.asset2Reserve : pool.asset1Reserve

        const amountInMicro = getAmountIn(amountOutMicro, reserveIn, reserveOut)
        // Max we're willing to pay (slippage buffer on the input)
        const maxAmountIn = (amountInMicro * BigInt(Math.floor((100 + slippagePct) * 10))) / 1000n

        const params = await algodClient.getTransactionParams().do()
        const transactions: algosdk.Transaction[] = []

        if (assetInId === ALGO_ASA_ID) {
          transactions.push(
            algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk.getApplicationAddress(pool.appId),
              amount: maxAmountIn,
              suggestedParams: params
            })
          )
        } else {
          transactions.push(
            algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk.getApplicationAddress(pool.appId),
              amount: maxAmountIn,
              assetIndex: assetInId,
              suggestedParams: params
            })
          )
        }

        transactions.push(
          algosdk.makeApplicationNoOpTxnFromObject({
            sender: senderAddress,
            appIndex: pool.appId,
            appArgs: [
              new TextEncoder().encode('fixed_output_swap'),
              algosdk.encodeUint64(amountOutMicro)
            ],
            foreignAssets: [assetInId, assetOutId].filter(v => v !== 0),
            suggestedParams: params
          })
        )

        algosdk.assignGroupID(transactions)
        const signedTxns = transactions.map(txn => algosdk.signTransaction(txn, sk).blob)
        const txnBlob = Buffer.concat(signedTxns.map(s => Buffer.from(s)))
        const { txid } = await algodClient.sendRawTransaction(txnBlob).do()
        await algosdk.waitForConfirmation(algodClient, txid, 5)

        const explorerUrl =
          network === 'algorand-testnet'
            ? `https://testnet.explorer.perawallet.app/tx/${txid}`
            : `https://explorer.perawallet.app/tx/${txid}`

        const inLabel = assetInId === ALGO_ASA_ID ? 'ALGO' : `ASA#${assetInId}`
        const outLabel = assetOutId === ALGO_ASA_ID ? 'ALGO' : `ASA#${assetOutId}`

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  swap: `~${microAlgoToAlgo(amountInMicro)} ${inLabel} → ${amountOut} ${outLabel}`,
                  estimatedAmountIn: `${microAlgoToAlgo(amountInMicro)} ${inLabel}`,
                  maxAmountIn: `${microAlgoToAlgo(maxAmountIn)} ${inLabel}`,
                  exactAmountOut: `${amountOut} ${outLabel}`,
                  network,
                  explorerUrl
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Swap failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
