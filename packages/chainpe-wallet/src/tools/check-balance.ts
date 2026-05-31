import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { getWalletAddress, getUsdcBalance, isAlgorandNetwork } from '@/clients.js'

async function getAlgoBalance(address: string, network: string): Promise<string> {
  const algodUrl =
    network === 'algorand-testnet'
      ? 'https://testnet-api.algonode.cloud'
      : 'https://mainnet-api.algonode.cloud'
  try {
    const algosdk = await import('algosdk')
    const algodClient = new algosdk.default.Algodv2('', algodUrl, '')
    const info = await algodClient.accountInformation(address).do()
    const micro = BigInt(info.amount ?? 0)
    const whole = micro / 1_000_000n
    const frac = micro % 1_000_000n
    return `${whole}.${frac.toString().padStart(6, '0')}`
  } catch {
    return 'unavailable'
  }
}

export function registerCheckBalance(
  server: McpServer,
  config: AppConfig
): void {
  server.tool(
    'check_balance',
    'Check wallet balances: USDC and native ALGO for gas fees on Algorand Testnet/Mainnet.',
    {},
    async () => {
      if (!config.canPay) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No wallet configured. Set ALGORAND_MNEMONIC environment variable.'
            }
          ],
          isError: true
        }
      }

      try {
        const address = await getWalletAddress(config.network, config)
        const usdcBalance = await getUsdcBalance(config.network, config)

        // For Algorand, also fetch native ALGO balance (needed for gas/swap fees)
        const result: Record<string, string | object> = {
          address,
          network: config.network,
          mode: config.mode,
          usdc: `${usdcBalance} USDC`
        }

        if (isAlgorandNetwork(config.network)) {
          const algoBalance = await getAlgoBalance(address, config.network)
          result.algo = `${algoBalance} ALGO`
          result.swapNote =
            'ALGO is needed for Algorand network fees (~0.001 ALGO/txn) and Tinyman swaps.'
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
