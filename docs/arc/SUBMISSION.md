# Submission — Arc Studio Continuity Track

## Checklist (all required by the Arc section of the ETHGlobal Mumbai prize page)

- [ ] Submission names the prize: "Arc Studio Continuity Track: Bring Your Project to Arc"
- [ ] Shareable Arc Studio project URL (from `arc-studio open`) that judges can open
- [ ] Working MVP: frontend (`apps/arc-dashboard`) + backend (proxy, `chainpe-cloud`)
- [ ] Architecture diagram in the README (export from `docs/arc/ARCHITECTURE.md`)
- [ ] Video demo + presentation: core functions, Arc Studio usage, Circle tools used
- [ ] Documentation (this folder) and public GitHub repo
- [ ] README section "Before the hackathon / During the hackathon" with the `avalanche-june-2026` tag and dated commits
- [ ] `docs/arc/STUDIO-LOG.md` with Studio runs: webUrl, traceId, deployments

## README block to paste

```md
## Before the hackathon (June 2026, Avalanche)
- x402 proxy CLI, SDK, AI tools, MCP wallet, ERC-8004 reputation, PolicyVault, hosted facilitator + indexer
- Live on Avalanche C-Chain mainnet 2026-06-17 (tag `avalanche-june-2026`)

## During ETHGlobal Mumbai (Arc)
- x402 v1 → v2; Arc mainnet/testnet networks
- Settlement through Circle Facilitator Service (seller proofs, pending handling)
- Circle Gateway nanopayments as a second rail
- ChainPeAccounts contract on Arc (provider accounts + Pro plan) — built and deployed with Arc Studio
- Provider dashboard — built with Arc Studio
- `chainpe doctor` listing readiness for Circle's Agent Marketplace
- Arc canonical ERC-8004 identity + reputation
```

## Demo script (≈ 3 minutes)

1. **0:00 Pain.** Circle's seller guide: Node 22, Express, five packages, custom middleware, then a manual listing.
2. **0:25 One command.** `chainpe start --network arc-testnet` in front of a plain API. `curl -i` shows the 402 with two options (exact + Gateway).
3. **0:55 Agent pays.** Claude with the ChainPe MCP wallet discovers and pays once via exact, once via Gateway. Show the Arc explorer tx.
4. **1:30 Dashboard.** Connect the seller wallet: revenue split by rail, buyer wallet, ERC-8004 rating from the agent. Switch wallet → empty (personalised).
5. **2:00 Doctor.** `chainpe doctor` all green; Circle listing submitted.
6. **2:20 Arc Studio.** Open the Studio workspace: `ChainPeAccounts`, tests, deployment trace, dashboard source.
7. **2:45 Close.** Before/after: live on Avalanche in June, rebuilt on Arc this weekend. Business model: free CLI, Pro dashboard in USDC.

## Pitch (30 s)

"Agents can pay for APIs on Arc today, but developers still write payment code, wire a facilitator
and get listed by hand. ChainPe turns any existing API into an agent-payable service on Arc in one
command. Circle settles it, Gateway handles nanopayments, Arc's ERC-8004 registry rates it, and every
registered developer gets a personalised dashboard — free to start, Pro in USDC. It ran on Avalanche
in June; this weekend we rebuilt it on Arc with Arc Studio."

## Likely judge questions

| Question | Answer |
|---|---|
| Who is the user? | Developers selling API calls, MCP tools or agents. Not merchants. |
| Why not just use Circle's seller guide? | Zero code, any language, both rails, listing prep, reputation, dashboard. |
| How do you make money? | Pro dashboard subscription paid in USDC on Arc; no cut of payments. |
| What did you build this weekend? | See README "During" + STUDIO-LOG.md + commits after the June tag. |
| Merchants? | Card networks will serve goods merchants; agents already pay developers per call in USDC. |
