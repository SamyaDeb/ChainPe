# Spec 10 — ERC-8004 identity + reputation on Arc

**Goal:** use Arc's canonical ERC-8004 registries — no ChainPe-deployed copies on Arc — so ratings are
portable across every Arc agent.

| Registry | Mainnet | Testnet |
|---|---|---|
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

**Verified 2026-11-06, Identity only:** the live testnet implementation `0x7274e874…9c02` matches
`contracts/abis/erc8004/IdentityRegistry.json`, and only adds `isAuthorizedOrOwner`. **Verified the same day, Reputation:** the live implementation `0x16e0FA7f…dA34` matches `contracts/abis/erc8004/ReputationRegistry.json`, 24 of 24 signatures.

## `chainpe identity [--agent-id <id>] [--update-uri] [--new]`

1. `agentId` in config (or `--agent-id`): require `ownerOf(agentId) == seller`. If not, stop with an explanation. Never mint over it.
2. No `agentId` and `balanceOf(seller) > 0`: recover the id through the explorer (`/api/v2/addresses/{addr}/nft?type=ERC-721`), confirmed with `ownerOf`. One token: use it. Several, or the explorer is down: stop and ask for `--agent-id`. The registry is not enumerable and the public RPC refuses long `eth_getLogs` ranges, so the explorer is the only practical lookup.
3. `balanceOf == 0`: `register(<publicUrl>/.well-known/agent.json)`, read `agentId` from `Registered`, save it at once. `--new` mints another on purpose.
4. Token URI differs from the expected URL: report it. `--update-uri` calls `setAgentURI`.

An RPC failure stops the command: it must never read as "this wallet has no identity", because a duplicate splits reputation.
`agentId` 0 cannot be linked, since `ChainPeAccounts` reads 0 as "no identity".

**Agent card**, served by the proxy at `/.well-known/agent.json`: `{ name, description, agent_type, capabilities, version, endpoint, x402: { networks, rails, priceUsd }, chainpe: { serviceKey } }`. Arc's docs leave these fields to the application; `agent_type`, `capabilities` and `version` follow the Arc tutorial. `--ipfs` is deferred: the card changes with the config, and pinning needs a provider key.

## Feedback

- Buyer side (`cp.giveFeedback`, MCP `give_feedback`) after a successful paid call; score 0–100, tags `x402`, `<route>`.
- The registry blocks self-feedback; the CLI never rates its own agent.
- The proxy advertises `agentId` in the `X-CHAINPE-AGENT-ID` response header so buyers don't search for it. The SDK and MCP wallet read that header first.

## Acceptance

- [x] `chainpe identity --network arc-testnet` mints and prints an agentId with an explorer link.
- [ ] A buyer rating appears in `chainpe-cloud` `/v1/me/reputation` and the dashboard.
