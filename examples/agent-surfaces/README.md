# ChainPe: the same tools in different agent frameworks

The same ChainPe discover and paid-fetch tools, used from two agent frameworks and the CLI.

| Surface | Entry | Tools |
|---|---|---|
| Vercel AI SDK | `vercel-agent.ts` | `@chainpearc/ai-tools/vercel` |
| LangChain (ReAct) | `langchain-agent.ts` | `@chainpearc/ai-tools/langchain` |
| CLI | `chainpe fetch <url>` | `@chainpearc/cli` |

All three pay in USDC on Arc testnet, and Circle settles each payment.

## Setup

```bash
cp .env.example .env     # CHAINPE_PRIVATE_KEY + ANTHROPIC_API_KEY
npm install              # links the local @chainpearc/* packages (build them first)
```

> Build the workspace packages once from the repo root so the `file:` links
> resolve: `npm install && npm run build`.

The paying wallet needs test USDC. Get it at https://faucet.circle.com (pick Arc Testnet). On Arc, gas is also paid in USDC.

## Run

```bash
# Vercel AI SDK agent
npm run vercel -- "Discover a service on ChainPe and call it"

# LangChain agent (same tools)
npm run langchain -- "Discover a service on ChainPe and call it"

# CLI, no LLM needed
chainpe discover weather
chainpe fetch "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Mumbai" \
  --network arc-testnet --rail exact --max 0.02
```

The live demo API above is the service in `examples/arc-demo`.
