import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { SpendingTracker } from '@/spending.js'
import { registerCheckBalance } from '@/tools/check-balance.js'
import { registerPay } from '@/tools/pay.js'
import { registerX402Fetch } from '@/tools/x402-fetch.js'
import { registerTransferUsdc } from '@/tools/transfer-usdc.js'
import { registerTransferAlgo } from '@/tools/transfer-algo.js'
import { registerTinymanSwaps } from '@/tools/tinyman-swap.js'
import { registerBazaarSearch } from '@/tools/bazaar-search.js'
import { registerRequestFunding } from '@/tools/request-funding.js'
import { registerSpendingReport } from '@/tools/spending-report.js'
import { registerCreateToken } from '@/tools/create-token.js'

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: 'chainpe-wallet',
    version: '0.2.0'
  })

  const spending = new SpendingTracker(config.budget)

  // Core wallet - Algorand only
  registerCheckBalance(server, config)
  registerTransferUsdc(server, config, spending)
  registerTransferAlgo(server, config)

  // x402 Payments
  registerPay(server, config, spending)
  registerX402Fetch(server, config, spending)

  // Budget & Funding
  registerSpendingReport(server, spending)
  registerRequestFunding(server, config)

  // DeFi / DEX
  registerTinymanSwaps(server, config)

  // Token Creation
  registerCreateToken(server, config)

  // Discovery
  registerBazaarSearch(server, config)

  return server
}


