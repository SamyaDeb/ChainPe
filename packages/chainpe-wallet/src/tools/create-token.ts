/**
 * create_token — Mint a new Algorand Standard Asset (ASA) from the agent wallet.
 *
 * On Algorand, token creation is a Layer-1 protocol feature — no smart contracts
 * needed. One transaction creates a fully-featured token (name, supply, decimals,
 * freeze/clawback controls). Great for memecoins, governance tokens, or reward tokens.
 *
 * Inspired by: algorand-remote-mcp-lite/src/tools/transactionManager/assetTransactions.ts
 */

import { z } from 'zod'
import algosdk from 'algosdk'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'

const ALGOD_URLS: Record<string, string> = {
  algorand: 'https://mainnet-api.algonode.cloud',
  'algorand-testnet': 'https://testnet-api.algonode.cloud'
}

export function registerCreateToken(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'create_token',
    'Mint a brand-new Algorand Standard Asset (ASA/token) from this agent wallet. ' +
      'Works exactly like creating an ERC-20, but at Layer-1 with no smart contracts required. ' +
      'Use this to launch a governance token, a memecoin, or a reward token for a community. ' +
      'The creator wallet automatically holds the entire supply and acts as manager.',
    {
      name: z
        .string()
        .max(32)
        .describe('Full name of the token, e.g. "ClaudeAI Coin" (max 32 chars)'),
      ticker: z
        .string()
        .max(8)
        .describe('Short ticker symbol, e.g. "CLAUDE" (max 8 chars)'),
      totalSupply: z
        .number()
        .int()
        .positive()
        .describe('Total number of tokens to create, e.g. 1000000 for 1 million'),
      decimals: z
        .number()
        .int()
        .min(0)
        .max(19)
        .default(6)
        .describe('Decimal precision (0 = NFT/whole units, 6 = like USDC, default: 6)'),
      url: z
        .string()
        .optional()
        .describe('Optional URL for token info, e.g. your project website'),
      note: z
        .string()
        .optional()
        .describe('Optional transaction note, e.g. "Launched by Claude Agent"'),
      freeze: z
        .boolean()
        .default(false)
        .describe('If true, give the creator freeze/unfreeze powers over holders (default: false)'),
      network: z
        .enum(['algorand', 'algorand-testnet'])
        .default('algorand-testnet')
        .describe('Network (default: algorand-testnet)')
    },
    async ({ name, ticker, totalSupply, decimals, url, note, freeze, network }) => {
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
        const creator = algosdk.encodeAddress(addr.publicKey)

        const params = await algodClient.getTransactionParams().do()

        // Build the ASA creation transaction
        const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          sender: creator,
          total: BigInt(totalSupply),
          decimals,
          defaultFrozen: false,
          assetName: name,
          unitName: ticker,
          assetURL: url,
          // Give manager powers to the creator so they can update/destroy the token
          manager: creator,
          reserve: creator,
          // Only set freeze/clawback if user explicitly requested it
          freeze: freeze ? creator : undefined,
          clawback: undefined,
          suggestedParams: params,
          note: note ? new TextEncoder().encode(note) : undefined
        })

        const signedTxn = algosdk.signTransaction(txn, sk)
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do()
        const confirmation = await algosdk.waitForConfirmation(algodClient, txid, 5)

        // The new Asset ID is returned in the confirmation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const assetId = Number((confirmation as any)['asset-index'] ?? (confirmation as any).assetIndex ?? 0)

        const explorerUrl =
          network === 'algorand-testnet'
            ? `https://testnet.explorer.perawallet.app/asset/${assetId}`
            : `https://explorer.perawallet.app/asset/${assetId}`

        const txExplorerUrl =
          network === 'algorand-testnet'
            ? `https://testnet.explorer.perawallet.app/tx/${txid}`
            : `https://explorer.perawallet.app/tx/${txid}`

        // Human-readable supply with decimals applied
        const displaySupply =
          decimals > 0
            ? (totalSupply / Math.pow(10, decimals)).toLocaleString() + ' ' + ticker
            : totalSupply.toLocaleString() + ' ' + ticker

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `🎉 Token "${name}" (${ticker}) successfully launched on ${network}!`,
                  token: {
                    name,
                    ticker,
                    assetId,
                    totalSupply: displaySupply,
                    decimals,
                    creator,
                    network,
                    url: url ?? null,
                    freezeEnabled: freeze
                  },
                  transactions: {
                    txid,
                    txExplorerUrl,
                    assetExplorerUrl: explorerUrl
                  },
                  nextSteps: [
                    `The entire supply of ${displaySupply} is now in your wallet.`,
                    `Other wallets must opt-in to ASA ID ${assetId} before they can receive tokens.`,
                    `Use transfer_usdc (for assets) or transfer_algo to distribute tokens.`
                  ]
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Token creation failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true
        }
      }
    }
  )
}
