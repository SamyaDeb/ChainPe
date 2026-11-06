# Spec 10 — ERC-8004 identity + reputation on Arc

**Goal:** use Arc's canonical ERC-8004 registries — no ChainPe-deployed copies on Arc — so ratings are
portable across every Arc agent.

| Registry | Mainnet | Testnet |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

**VERIFY** before coding: compare the canonical ABIs (explorer "Contract" tab or Arc docs MCP) with
`contracts/abis/erc8004/*.json`. Our Avalanche copies are the reference contracts, so they should match;
if a function signature differs, add an Arc ABI file instead of editing the shared one.

## `chainpe identity`

1. If config has `agentId` and `ownerOf(agentId) == seller`, print it and exit.
2. Build agent card JSON: `{ name, description, endpoint, x402: { networks, rails, priceUsd }, chainpe: { serviceKey } }`.
3. Host it: served by the proxy at `/.well-known/agent.json`; `agentURI` = that URL (or IPFS if `--ipfs`).
4. `register(agentURI)` on the IdentityRegistry; read `agentId` from the `Registered`/`Transfer` log (existing `packages/chainpe/src/erc8004.ts` logic).
5. Save `agentId`; `chainpe register` reuses it.

Reuse `packages/chainpe/src/erc8004.ts` with network-aware addresses.

## Feedback

- Buyer side (`cp.giveFeedback`, MCP `give_feedback`) after a successful paid call; score 0–100, tags `x402`, `<route>`.
- The registry blocks self-feedback; the CLI never rates its own agent.
- The proxy advertises `agentId` in the `X-CHAINPE-AGENT-ID` response header so buyers don't search for it. The SDK and MCP wallet read that header first.

## Acceptance

- [ ] `chainpe identity --network arc-testnet` mints and prints an agentId with an explorer link.
- [ ] A buyer rating appears in `chainpe-cloud` `/v1/me/reputation` and the dashboard.
