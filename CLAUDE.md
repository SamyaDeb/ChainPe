# CLAUDE.md — ChainPe

ChainPe turns any existing HTTP API, MCP server or AI agent into an agent-payable
service. It was live on Avalanche C-Chain (June 2026). We are now moving it to
**Circle's Arc** for the ETHGlobal Mumbai **Arc Studio Continuity Track**.

**Read first:** `docs/arc/README.md` (index), then `docs/arc/PRD.md`.
Build order and acceptance criteria: `docs/arc/BUILD-PLAN.md`.

## Ground rules for this port

- User = **developers (providers)** who sell API calls to agents. Not merchants.
- Use Circle's services; do not rebuild them:
  - settlement → Circle Facilitator Service (`https://api.circle.com/v1/facilitator/x402`)
  - nanopayments → Circle Gateway via `@circle-fin/x402-batching`
  - discovery → Circle Discovery API (`https://api.circle.com/v2/x402/discovery/resources`)
  - identity/reputation → Arc's canonical ERC-8004 registries (addresses in `docs/arc/ARCHITECTURE.md`)
- The CLI (`packages/chainpe`) is Arc-only: `arc` and `arc-testnet`, settled through Circle. Avalanche (`avalanche`, `fuji`) was removed from it because Circle's services don't cover Avalanche. Other packages still target Avalanche until their Arc work lands.
- x402 v1 (`x402`, `x402-express`, `x402-fetch` 1.2.0) has **no Arc**. Use x402 v2 (`@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` 2.30.x).
- Arc gas is USDC. Native USDC = 18 decimals, ERC-20 USDC (`0x3600…0000`) = 6 decimals. Always use the ERC-20 interface for amounts.
- Never forward a request to the provider backend before settlement is `completed` (not `pending`).
- Never log or commit private keys. `.env*` stays out of git and out of Arc Studio uploads.
- Every change lands on branch `arc`. Commits are small and dated (judges check before/during work).

## Arc Studio

Arc Studio is required by the prize. Use it for the **contracts** and the **provider dashboard**
(its sandbox is a Vite + Foundry app: Solidity in `contracts/`, web in `src/`).
Node services (CLI proxy, SDK, cloud API) are built locally by Claude Code.
How to drive it: `docs/arc/ARC-STUDIO.md`. Prompts: `docs/arc/prompts/`.

```sh
npm install -g @circle-fin/arc-studio-cli
arc-studio skills install --tool claude-code
arc-studio login
claude mcp add --transport http arc-docs https://docs.arc.io/mcp   # Arc docs search for Claude Code
```

## Repo map

| Path | What | Arc work |
|---|---|---|
| `packages/chainpe` | `@chainpeavax/cli` — provider CLI + x402 proxy | specs 01, 02, 03, 04, 05, 06 |
| `packages/chainpe-sdk` | `@chainpeavax/sdk` — buyer SDK | spec 09 |
| `packages/chainpe-ai-tools` | Vercel AI / LangChain tools | spec 09 |
| `packages/chainpe-wallet` | `chainpe-wallet-mcp` — Claude MCP wallet | spec 09 |
| `packages/chainpe-agent` | `@chainpeavax/agent` | spec 09 (network only) |
| `services/chainpe-indexer` | becomes `chainpe-cloud` API | spec 08 |
| `services/chainpe-facilitator` | retired for Arc (Circle replaces it) | not used by the CLI |
| `contracts/` | Hardhat, Avalanche contracts | Arc contracts built in Arc Studio → `contracts-arc/` |
| `apps/dashboard` | marketing site (Next.js) | copy fixes only |
| `apps/arc-dashboard` | NEW — provider dashboard pulled from Arc Studio | spec 07 |

## Commands

```sh
npm install && npm run build && npm test
npm run build:cli && node packages/chainpe/dist/cli.js start --network arc-testnet
```

## Verify before you trust

Items marked **VERIFY** in the docs were not confirmed in Circle/Arc docs at time of writing
(e.g. settle-before-handler payment flow, ERC-8004 ABI match). Check with the Arc docs MCP or the
Circle mentors before shipping them.
