import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { SpendingTracker } from '@/spending.js'
import { registerCheckBalance } from '@/tools/check-balance.js'
import { registerPay } from '@/tools/pay.js'
import { registerX402Fetch } from '@/tools/x402-fetch.js'
import { registerTransferUsdc } from '@/tools/transfer-usdc.js'
import { registerTransferAvax } from '@/tools/transfer-avax.js'
import { registerBazaarSearch } from '@/tools/bazaar-search.js'
import { registerRequestFunding } from '@/tools/request-funding.js'
import { registerSpendingReport } from '@/tools/spending-report.js'
import { registerGiveFeedback } from '@/tools/give-feedback.js'

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer({
    name: 'chainpe-wallet',
    version: '0.3.0'
  })

  const spending = new SpendingTracker(config.budget)

  // Core wallet — Avalanche C-Chain
  registerCheckBalance(server, config)
  registerTransferUsdc(server, config, spending)
  registerTransferAvax(server, config)

  // x402 Payments
  registerPay(server, config, spending)
  registerX402Fetch(server, config, spending)

  // Budget & Funding
  registerSpendingReport(server, spending)
  registerRequestFunding(server, config)

  // Discovery
  registerBazaarSearch(server, config)

  // On-chain reputation (ERC-8004)
  registerGiveFeedback(server, config)

  return server
}
