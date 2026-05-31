import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import type { SpendingTracker } from '@/spending.js'
import { isNfdName, resolveNfd } from '@/nfd.js'

const USDC_ASA: Record<string, number> = {
  algorand: 31566704,           // USDC mainnet
  'algorand-testnet': 10458941  // USDC testnet
}

const ALGOD_URLS: Record<string, string> = {
  algorand: 'https://mainnet-api.algonode.cloud',
  'algorand-testnet': 'https://testnet-api.algonode.cloud'
}

export function registerTransferUsdc(
  server: McpServer,
  config: AppConfig,
  spending: SpendingTracker
): void {
  server.tool(
    'transfer_usdc',
    'Send USDC directly on-chain from your Algorand wallet to another address. This is a real on-chain ASA transfer — NOT an x402 payment header. Use this to send USDC to a friend, top up a wallet, or move funds.',
    {
      to: z.string().describe('Recipient: an Algorand address (58 chars) OR an NFD name like "satoshi.algo" or "bob.nfd"'),
      amount: z
        .string()
        .describe('USDC amount as decimal string, e.g. "1.50" for $1.50 USDC'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Algorand network (default: algorand-testnet)'),
      note: z
        .string()
        .optional()
        .describe('Optional memo/note to include in the transaction (max 1000 bytes)')
    },
    async ({ to, amount, network, note }) => {
      if (!config.algorandMnemonic) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No Algorand wallet configured. Set ALGORAND_MNEMONIC environment variable.'
            }
          ],
          isError: true
        }
      }

      try {
        spending.check(amount)

        // ── NFD resolution ───────────────────────────────────────────────────
        let resolvedTo = to
        if (isNfdName(to)) {
          resolvedTo = await resolveNfd(to)
        }

        const algosdk = (await import('algosdk')).default
        const { sk, addr } = algosdk.mnemonicToSecretKey(config.algorandMnemonic)
        const sender = algosdk.encodeAddress(addr.publicKey)

        const algodUrl = ALGOD_URLS[network] ?? ALGOD_URLS['algorand-testnet']
        const algodClient = new algosdk.Algodv2('', algodUrl, '')

        // Convert USDC decimal amount → microUSDC (6 decimals)
        const parts = amount.split('.')
        const whole = parts[0] || '0'
        const frac = (parts[1] || '').padEnd(6, '0').slice(0, 6)
        const microUsdc = BigInt(whole) * 1_000_000n + BigInt(frac)

        if (microUsdc <= 0n) {
          return {
            content: [{ type: 'text' as const, text: 'Amount must be greater than 0.' }],
            isError: true
          }
        }

        const assetId = USDC_ASA[network]
        if (!assetId) {
          return {
            content: [{ type: 'text' as const, text: `Unknown network: ${network}` }],
            isError: true
          }
        }

        // Build the asset transfer transaction
        const suggestedParams = await algodClient.getTransactionParams().do()
        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender,
          receiver: resolvedTo,
          amount: microUsdc,
          assetIndex: assetId,
          suggestedParams,
          note: note ? new TextEncoder().encode(note) : undefined
        })

        // Sign and submit
        const signedTxn = algosdk.signTransaction(txn, sk)
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do()

        // Wait for confirmation
        const confirmation = await algosdk.waitForConfirmation(algodClient, txid, 5)

        spending.record(amount, resolvedTo, network)

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
                  amount: `${amount} USDC`,
                  assetId,
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
