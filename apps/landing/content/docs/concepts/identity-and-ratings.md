---
title: Identity and ratings
description: ERC-8004 identities and reputation on Arc's official registries.
---

ERC-8004 is a standard on-chain registry for agent identities and ratings. ChainPe uses Arc's official registries and deploys no copies of its own, so ratings stay portable across every Arc agent. The addresses are in [networks and addresses](/docs/reference/networks).

## Your identity

```bash
chainpe identity
```

This finds your wallet's identity, or mints one that points to `<publicUrl>/.well-known/agent.json`. It saves the id in your config.

| Option | What it does |
|---|---|
| `--agent-id <id>` | Uses this id, which your wallet must own |
| `--update-uri` | Points the identity at this service's agent card |
| `--new` | Mints another identity, even if the wallet has one |

If the network fails, the command stops rather than reading that as "no identity". A duplicate identity would split your ratings.

## Ratings

Buyers rate a provider from 0 to 100 after a call:

```ts
await cp.giveFeedback(agentId, 90)
```

Or set `autoFeedback: true` on the SDK to rate after every paid call. A rating is an on-chain transaction, so it costs a little gas in USDC. You can't rate your own agent.

## Limits

Anyone can rate an agent on ERC-8004, whether or not they paid. The dashboard shows ratings from real payers first.
