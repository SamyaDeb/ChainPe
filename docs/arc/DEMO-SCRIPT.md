# Demo video: 3:50 shot list

For the Arc Studio Continuity Track at ETHGlobal Mumbai. Submissions close **Saturday, November 7, 2026 at 09:00 IST**.

The narration in the recorded cut is in [VOICEOVER.md](VOICEOVER.md). It replaces the lines below where they differ.

## Video rules

- Between 2:00 and 4:00. Anything longer is rejected on upload, so aim for 3:50.
- Use your own voice. No AI voiceover, and no music with on-screen text in place of talking.
- Don't speed up the video. Cutting out waiting time is fine.
- At least 720p. Record at 1080p. Don't record on a phone.
- No more than 4 bullets per slide.
- Studio must appear, and the video must cover core functions and how the project uses Arc Studio and Circle's tools.

## Before you record

- [ ] Agents are up: `node examples/arc-swap-agents/up.mjs`, then wait for "All agents are up"
- [ ] Weather seller and chainpe-cloud answer on `/health`
- [ ] Buyer has at least 3 USDC and a Gateway balance. The MCP wallet's daily limit has room, or `MAX_PER_DAY` in `examples/arc-swap-agents/mcp.json` is raised
- [ ] Browser window 1 is signed in as the seller, on Overview
- [ ] Browser window 2 is signed in as the buyer, on Overview
- [ ] Arc Studio is signed in, with `ChainPeAccounts.sol` open
- [ ] Terminal uses 18pt or larger, and no tab or editor shows `.env`
- [ ] Sellers' terminal has the right config loaded (the `.env` value of `CHAINPE_CONFIG` is an old config and makes `chainpe start` fail):

```sh
set -a; source .env; set +a
export CHAINPE_CONFIG=$PWD/examples/arc-demo/config.json
PORT=3001 node examples/weather-api/server.mjs &
alias chainpe="node $PWD/packages/chainpe/dist/cli.js"
```

## Shots

### 0:00–0:18 Problem (slide or camera)

"AI agents can read, write code and browse, but they can't pay. If an agent needs data or a trade, someone hard-codes an API key or a card. That doesn't scale to software buying from software."

### 0:18–0:32 Solution (architecture diagram from the README)

"ChainPe turns any API, MCP server or agent into a service agents can pay for per call, in USDC on Arc. Circle settles the payment, and ERC-8004 records who can be trusted."

### 0:32–1:00 Developer: put a price on an API

Show `chainpe init` with the answers ready (wizard, cut the typing), then `chainpe start --network arc-testnet`, then:

```sh
curl -i "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Tokyo"
```

"This is a normal API with no payment code. One wizard, one command, and it has a price. An unpaid request gets 402 Payment Required, with two ways to pay: a direct USDC payment, or a Circle Gateway nanopayment."

### 1:00–1:14 Register and check

```sh
chainpe register --network arc-testnet
chainpe doctor
```

"Registering gives it an on-chain account and an ERC-8004 identity on Arc. Doctor checks it's ready for agents and for Circle's marketplace: ten out of ten."

### 1:14–1:26 Agent builder: a few lines of SDK (editor)

```js
const cp = new ChainPe({ privateKey, network: 'arc-testnet' })
const [best] = await cp.discover('swap')
const { data, payment } = await cp.pay(`${best.endpoint}/quote`, { method: 'POST', body })
```

"On the buyer's side it's a few lines. Discovery comes back ranked by reputation, and `pay` handles the 402."

### 1:26–2:11 Claude Desktop compares agents and pays for a quote (cut the waiting)

```sh
./examples/arc-swap-agents/demo.sh --allowedTools mcp__chainpe-wallet
```

> Find the swap agents on Arc and compare their on-chain ratings and fees. Pay the best-rated one for a live quote on swapping 1 USDC to EURC, and tell me why you picked it. Give me the payment transaction link.

Show the search, the ratings, the quotes, the payment and the comparison table, then open the swap transaction.

"I'm not going to talk about this anymore. Let me show you, live. This is Claude Desktop, with the ChainPe wallet configured: Arc testnet, spending limits, and the key stays masked. I ask Claude to compare the swap agents and pay the best-rated one for a live quote. It finds three agents, with ratings from the chain. Drift is the cheapest, but it's a bad actor I built: it keeps five percent, and its score shows it. So Claude picks Bolt, asks for my OK, and pays over x402. And here's the transaction on Arc."

Claude Desktop will not run the swap itself, even on testnet, so it pays for a quote and the script below runs the swap.

### 2:11–2:33 Agents hire agents (script, real swap)

```sh
node examples/arc-swap-agents/hire-best.mjs
```

"Now the same thing with no chat, and a real swap. This script is an agent hiring another agent. It discovers them, pays for live quotes, and hires the best value. The agent swaps through Circle App Kit, the script measures what really arrived on-chain, and posts that score to ERC-8004. I seeded the first ratings from a test wallet, and every one came from a real paid swap."

### 2:33–2:57 Personalised dashboard

Window 1: Overview, Payments, Reputation, Listing health. Then window 2 for three seconds.

"Every developer signs in with their wallet and gets their own dashboard: revenue checked against Arc and Circle's records, every payment, every buyer, their reputation and listing health. Another wallet sees only its own services, on the Free plan."

Don't open Services as the seller (it starts with old test listings) or the browser console.

### 2:57–3:20 Arc Studio and Circle's tools

In Studio: `ChainPeAccounts.sol`, its tests, the deployment, then the dashboard preview.

"We built the contracts and this dashboard in Arc Studio: accounts, plans and fees, tested and deployed to Arc testnet from here. Settlement runs on Circle's Facilitator, nanopayments on Gateway, discovery on Circle's Discovery API, and swaps on App Kit. We didn't rebuild any of them."

### 3:20–3:38 Business model (Billing page, then a slide)

"The CLI and SDK are free. Buyers pay developers directly, so we never hold funds. We earn from the Pro dashboard, paid in USDC on Arc: 1 USDC on testnet, and we plan 19 on mainnet. Next is an opt-in usage fee of 1% of verified revenue. The fee contract is on testnet, and turning it on is our next step."

### 3:38–3:50 Close (README "Before and during" section)

"ChainPe ran on Avalanche in June. This weekend we brought it to Arc: new contracts, a new dashboard and real payments on testnet. Software is about to start buying from software. ChainPe is how it pays, and how it knows who to trust."

## If something breaks while recording

- A Gateway payment shows `received`, not `completed`: that is normal. The batch lands in a few minutes.
- The seller is slow on the first call: make one warm-up call before you start recording.
- A swap reverts on thin testnet liquidity: the agent refunds the swap amount and keeps its fee. Retake it, or keep it and say so.
- The agents' tunnel URLs change on every restart, and the listings update. Ratings carry over.

## After recording

Check the exported length is under 4:00 and that no key or `.env` value appears on screen.
