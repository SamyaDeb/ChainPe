# ChainPe — agent-to-agent marketplace (sellers + reputation)

The flagship demo: **agents that get paid to do real work, and an agent that
hires them.** Two LLM-backed seller agents are monetized per request in USDC on
Avalanche; a buyer orchestrator discovers them (ranked by ⭐ ERC-8004
reputation), hires both in sequence, pays each, and composes the result — and
every paid call bumps the seller's on-chain reputation.

```
buyer (orchestrator.mjs)
   │  discover (ranked by ⭐)
   ├──pay USDC──▶ Research Agent   (LLM)  ──┐
   │                                        │ research brief
   └──pay USDC──▶ News Digest Agent (LLM) ◀─┘  → final digest
        each paid call → ERC-8004 reputation +100 to the seller's agentId
```

| Piece | File |
|---|---|
| Research seller (`POST /research {topic}`) | `research-agent.mjs` |
| News-digest seller (`POST /summarize {text}`) | `news-digest-agent.mjs` |
| Buyer orchestrator (discover → hire both → compose) | `orchestrator.mjs` |
| Mint an ERC-8004 identity → `agentId` | `mint-identity.mjs` |
| Register a seller on-chain (non-interactive) | `register-seller.mjs` |
| One-shot launcher | `launch.sh` |

Each seller runs its LLM backend behind the **same ChainPe x402 gateway** that
`chainpe start` uses (started programmatically via `@chainpe/cli`), so two
sellers run side by side. The gateway advertises each seller's `agentId` on the
402 response (feature 3b) so the buyer can leave feedback without scanning the
registry.

## Setup

```bash
# From the repo root, once: build the local @chainpe/* packages.
npm install && npm run build

# Here:
cp .env.example .env      # fill in keys (see below)
npm install               # links the local @chainpe/* packages
```

You need **three distinct wallets**: the buyer (`CHAINPE_PRIVATE_KEY`) and one per
seller (`RESEARCH_PAYTO*`, `DIGEST_PAYTO*`). ERC-8004 blocks self-feedback, so the
buyer must differ from the sellers for reputation to accrue. Fund the buyer with
USDC on Avalanche C-Chain (available on major CEXes or bridges) and the facilitator/seller gas wallets
with a little AVAX (available on major exchanges; for Fuji testnet use <https://faucet.avax.network>).

## 1. Launch the sellers + register them

```bash
REGISTER=1 ./launch.sh
```

This starts both sellers, waits for health, then runs `register-seller.mjs` for
each. Registration now **automatically mints an ERC-8004 identity** for each
seller wallet if one doesn't exist yet — no separate step needed. The printed
`agentId` is the token that accrues reputation on each paid call. Leave it running.

## 3. Run the buyer

```bash
npm run orchestrate -- "The state of AI agents and on-chain payments in 2026"
```

You'll see the buyer discover the sellers (ranked by ⭐), pay each in USDC (with a
Snowtrace tx), receive real LLM output, and post reputation. Run it again and the
sellers' ⭐ scores have gone up — visible via `chainpe discover` or in the buyer's
discovery output.

### All-in-one

```bash
REGISTER=1 ORCHESTRATE=1 TOPIC="..." ./launch.sh
```
