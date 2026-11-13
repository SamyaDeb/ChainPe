/**
 * Shared runtime for the seller agents.
 *
 * Each seller runs its LLM backend (private port) behind a ChainPe x402 proxy
 * (public port) in one process — the same gateway `chainpe start` uses, started
 * programmatically via `@chainpe/cli` so two sellers can run side by side with
 * independent configs. The proxy advertises the seller's ERC-8004 `agentId` on
 * the 402 (3b), so buyers can leave reputation without scanning the registry.
 */
import 'dotenv/config'
import { startProxyServer } from '@chainpe/cli'

export function requireEnv(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env ${name}. See .env.example.`)
    process.exit(1)
  }
  return v
}

export async function startSeller({
  name,
  app,
  backendPort,
  proxyPort,
  payTo,
  price,
  description,
  tags,
  agentId,
}) {
  // 1. Start the LLM backend on a private localhost port.
  await new Promise((resolve) => app.listen(backendPort, resolve))

  // 2. Put the ChainPe x402 gateway in front of it.
  const config = {
    serviceName: name,
    serviceDescription: description,
    tags,
    targetUrl: `http://localhost:${backendPort}`,
    pricePerRequest: price,
    paymentToken: 'USDC',
    walletAddress: payTo,
    proxyPort,
    network: process.env.CHAINPE_NETWORK || 'fuji',
    registryAddress: process.env.CHAINPE_REGISTRY_ADDRESS,
    facilitatorUrl: process.env.CHAINPE_FACILITATOR_URL,
    agentId: agentId && agentId !== '0' ? agentId : undefined,
    logLevel: 'normal',
  }
  const facilitatorKey = process.env.CHAINPE_FACILITATOR_KEY

  if (!facilitatorKey && !config.facilitatorUrl) {
    console.warn(
      `\n  ⚠ ${name}: no facilitator configured — payments can't settle.\n` +
        '    Set CHAINPE_FACILITATOR_KEY (in-process) or CHAINPE_FACILITATOR_URL.',
    )
  }

  await startProxyServer({ config, facilitatorKey })

  console.log(`\n  ✓ ${name}`)
  console.log(`    backend:  http://localhost:${backendPort}`)
  console.log(`    x402:     http://localhost:${proxyPort}`)
  console.log(`    payTo:    ${payTo}  ·  ${price} USDC/call`)
  console.log(`    agentId:  ${config.agentId ?? 'none (run mint-identity.mjs to link one)'}`)
}
