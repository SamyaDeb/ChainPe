# ChainPe — multi-surface agent examples

The **same** ChainPe discover + paid-fetch tools, driving two different agent
frameworks plus the CLI. This is the "it's infrastructure, not a Claude-only
app" proof: one payment + reputation core, many surfaces.

| Surface | Entry | Tools |
|---|---|---|
| Vercel AI SDK | `vercel-agent.ts` | `@chainpe/ai-tools/vercel` |
| LangChain (ReAct) | `langchain-agent.ts` | `@chainpe/ai-tools/langchain` |
| CLI (curl-level) | `chainpe fetch <url>` | `@chainpe/cli` → `@chainpe/sdk` |

All three settle USDC on Avalanche C-Chain through the same `@chainpe/sdk` core.

## Setup

```bash
cp .env.example .env     # CHAINPE_PRIVATE_KEY + ANTHROPIC_API_KEY
npm install              # links the local @chainpe/* packages (build them first)
```

> Build the workspace packages once from the repo root so the `file:` links
> resolve: `npm install && npm run build`.

The paying wallet needs a little USDC on Avalanche C-Chain (available on major CEXes or bridges, e.g. [Stargate](https://stargate.finance)). Gas is paid by the provider's facilitator.

## Run

```bash
# Vercel AI SDK agent
npm run vercel -- "Discover a service on ChainPe and call it"

# LangChain agent (same tools, same result)
npm run langchain -- "Discover a service on ChainPe and call it"

# CLI — no LLM needed
chainpe discover                              # browse, ranked by ⭐ reputation
chainpe fetch https://your-service/endpoint   # auto-pays the 402 in USDC
```

To have something live to pay, run one of the sibling example APIs behind a
ChainPe proxy (`../weather-api.mjs` → `chainpe init/start/register`), or a seller
agent from `examples/seller-agents/` (Phase 3).
