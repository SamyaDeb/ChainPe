# ChainPe → Arc: document index

Read in this order.

| # | File | What it answers |
|---|---|---|
| 1 | [PRD.md](PRD.md) | What we build, for whom, and what "done" means |
| 2 | [BUSINESS-MODEL.md](BUSINESS-MODEL.md) | Registration, personalised dashboard, plans, revenue |
| 3 | [ARCHITECTURE.md](ARCHITECTURE.md) | Components, flows, Arc + Circle constants, env vars |
| 4 | [ARC-STUDIO.md](ARC-STUDIO.md) | How Arc Studio CLI is used (contracts + dashboard) |
| 5 | [BUILD-PLAN.md](BUILD-PLAN.md) | Phases, order, acceptance criteria |
| 6 | [SUBMISSION.md](SUBMISSION.md) | Prize checklist, demo script, pitch, README before/after |
| 7 | [STUDIO-LOG.md](STUDIO-LOG.md) | Arc Studio runs: webUrl, traceId, deployments (judge evidence) |

## Specs (one per work item)

| Spec | Area |
|---|---|
| [01-x402-v2-and-arc-networks.md](specs/01-x402-v2-and-arc-networks.md) | Network config + x402 v1 → v2 migration |
| [02-circle-facilitator-adapter.md](specs/02-circle-facilitator-adapter.md) | Settle through Circle with seller proof |
| [03-gateway-nanopayments.md](specs/03-gateway-nanopayments.md) | Second rail: Circle Gateway batched payments |
| [04-cli-proxy-arc.md](specs/04-cli-proxy-arc.md) | `chainpe start --network arc` behaviour |
| [05-chainpe-doctor.md](specs/05-chainpe-doctor.md) | Listing readiness + Circle marketplace prep |
| [06-provider-accounts.md](specs/06-provider-accounts.md) | Registration, plans, `ChainPeAccounts` contract |
| [07-provider-dashboard.md](specs/07-provider-dashboard.md) | Personalised dashboard (built in Arc Studio) |
| [08-chainpe-cloud-api.md](specs/08-chainpe-cloud-api.md) | Backend: auth, telemetry, Arc indexing |
| [09-buyer-sdk-mcp.md](specs/09-buyer-sdk-mcp.md) | SDK, AI tools, MCP wallet on Arc |
| [10-erc8004-identity.md](specs/10-erc8004-identity.md) | Identity + reputation on Arc's registries |
| [11-policyvault-arc.md](specs/11-policyvault-arc.md) | Stretch: on-chain spend caps on Arc |
| [12-usage-fees.md](specs/12-usage-fees.md) | The usage fee: a percentage of verified revenue, collected from an allowance |

## Arc Studio prompts

| File | Used for |
|---|---|
| [prompts/studio-01-contracts.md](prompts/studio-01-contracts.md) | Write, test, deploy `ChainPeAccounts` (+ PolicyVault) on Arc testnet |
| [prompts/studio-02-dashboard.md](prompts/studio-02-dashboard.md) | Build the provider dashboard |
| [prompts/studio-03-review.md](prompts/studio-03-review.md) | Contract review + dashboard polish pass |
