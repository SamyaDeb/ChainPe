/**
 * transfer_algo — Send native ALGO from the agent wallet to any address or NFD name.
 * 
 * Unlike transfer_usdc (which moves an ASA), this moves the native Algorand currency.
 * Supports NFD (.algo/.nfd) name resolution exactly like transfer_usdc.
 */

import { z } from 'zod'
import algosdk from 'algosdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { isNfdName, resolveNfd } from '@/nfd.js'

const ALGOD_URLS: Record<string, string> = {
  algorand: 'https://mainnet-api.algonode.cloud',
  'algorand-testnet': 'https://testnet-api.algonode.cloud'
}

export function registerTransferAlgo(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'transfer_algo',
    'Send native ALGO from this agent wallet to another address or NFD name (e.g. "satoshi.algo"). ' +
      'Use this to pay for Algorand network fees, seed a new wallet, or transfer value in ALGO. ' +
      'For USDC transfers, use transfer_usdc instead.',
    {
      to: z
        .string()
        .describe('Recipient: an Algorand address (58 chars) OR an NFD name like "satoshi.algo" or "bob.nfd"'),
      amount: z
        .string()
        .describe('Amount of ALGO to send as decimal string, e.g. "1.5" for 1.5 ALGO'),
      note: z
        .string()
        .optional()
        .describe('Optional memo/note to include in the transaction (max 1000 bytes)'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Algorand network (default: algorand-testnet)')
    },
    async ({ to, amount, note, network }) => {
      if (!config.algorandMnemonic) {
        return {
          content: [{ type: 'text' as const, text: 'No Algorand wallet configured. Set ALGORAND_MNEMONIC.' }],
          isError: true
        }
      }

      try {
        // ── NFD Resolution ──────────────────────────────────────────────────────
        let resolvedTo = to
        if (isNfdName(to)) {
          resolvedTo = await resolveNfd(to)
        }

        const algodUrl = ALGOD_URLS[network] ?? ALGOD_URLS['algorand-testnet']
        const algodClient = new algosdk.Algodv2('', algodUrl, '')
        const { sk, addr } = algosdk.mnemonicToSecretKey(config.algorandMnemonic)
        const sender = algosdk.encodeAddress(addr.publicKey)

        // Convert ALGO decimal → microALGO (6 decimals)
        const parts = amount.split('.')
        const whole = parts[0] || '0'
        const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6)
        const microAlgo = BigInt(whole) * 1_000_000n + BigInt(frac)

        if (microAlgo <= 0n) {
          return {
            content: [{ type: 'text' as const, text: 'Amount must be greater than 0.' }],
            isError: true
          }
        }

        const suggestedParams = await algodClient.getTransactionParams().do()
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: resolvedTo,
          amount: microAlgo,
          suggestedParams,
          note: note ? new TextEncoder().encode(note) : undefined
        })

        const signedTxn = algosdk.signTransaction(txn, sk)
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do()
        const confirmation = await algosdk.waitForConfirmation(algodClient, txid, 5)

        const explorerUrl =
          network === 'algorand-testnet'
            ? `https://testnet.explorer.perawallet.app/tx/${txid}`
            : `https://explorer.perawallet.app/tx/${txid}`

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  from: sender,
                  to: resolvedTo,
                  nfd: resolvedTo !== to ? to : undefined,
                  amount: `${amount} ALGO`,
                  network,
                  confirmedRound: Number(confirmation.confirmedRound ?? 0),
                  explorerUrl,
                  note: note ?? null
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
              text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
