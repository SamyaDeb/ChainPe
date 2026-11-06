# Why Avalanche for ChainPe

ChainPe is **pay-per-HTTP-request** infrastructure for AI agents. That workload —
thousands of tiny, independent USDC payments with a human (or agent) waiting on
the result — has two hard requirements: **fees low enough that a $0.01 API call
isn't dwarfed by gas**, and **finality fast + deterministic enough to settle
inside a live request/response loop**. Avalanche C-Chain delivers both.

## Measured (live, reproducible)

Run it yourself: `node examples/avalanche-bench/bench.mjs` (read-only, no funds).

| Metric | Avalanche C-Chain (mainnet, measured) |
|---|---|
| Avg block time | **~3.0 s** (last 30 blocks) |
| Finality | **~1–2 s, deterministic — no reorgs** (Snowman consensus) |
| Live gas price | ~25 gwei base fee (post-Etna/ACP-125); see fee table below |

Finality matters more than block time here: Avalanche reaches **irreversible**
finality in a second or two with no probabilistic re-org window, so a facilitator
can return a settled `200` to the agent almost immediately — unlike chains where
you wait for N confirmations before trusting a payment.

## Fees (projected at a representative gas price)

Testnet gas is effectively zero, so it's not a fair basis. Projected at **1 gwei**
(typical of Avalanche C-Chain after the Etna/ACP-125 fee reduction) and **AVAX =
$40**, `fee = gasPrice × gas × AVAX_USD`:

| ChainPe operation | ~gas | Cost | per $1 |
|---|---|---|---|
| x402 settlement (USDC EIP-3009 transfer) | 75k | **$0.003** | ~333 |
| ERC-8004 `giveFeedback` (reputation) | 120k | $0.005 | ~208 |
| Register a service | 210k | $0.008 | ~119 |
| PolicyVault gasless spend | 95k | $0.004 | ~263 |

**Sub-cent settlement** means a 1-cent API call is economically real: gas is a few
percent of the payment, not 10×. (Recompute for any gas price / AVAX price with
the env vars on the script.)

## How ChainPe leans into Avalanche specifically

- **Native USDC + EIP-3009.** Circle-issued USDC on Avalanche C-Chain
  (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`) with `transferWithAuthorization` is what
  makes the x402 *exact* scheme work — the payer signs, the facilitator submits.
- **Agents hold zero AVAX.** The non-custodial facilitator pays gas and relays the
  payer's signed authorization; PolicyVault spends are relayer-submitted too. Cheap
  Avalanche gas makes "the platform eats the gas" sustainable — agents only need
  USDC.
- **x402 network ids** `avalanche` (mainnet) / `avalanche-fuji` (testnet) are first-class in the
  Coinbase x402 stack ChainPe builds on. ChainPe targets `avalanche` by default.
- **On-chain reputation in the hot path.** Because fees + finality are low, leaving
  ERC-8004 feedback after *every* paid call (and reading it during discovery) is
  practical — reputation accrues continuously instead of being too expensive to bother.
- **Deterministic finality** underpins the PolicyVault "the chain blocks an
  overspend" guarantee: a rejected spend is rejected *immediately and finally*.

## Avalanche-native: cross-L1 hiring over ICM (Teleporter)

The Avalanche agent economy is **multi-L1** — agents and services live on
different subnets. ChainPe uses **Avalanche Interchain Messaging (ICM /
Teleporter)** so an agent on its own L1 can hire a service registered on another
L1 (e.g. the C-Chain) **without leaving Avalanche** — no bridges, no wrapped
assets.

- `contracts/contracts/icm/ChainPeICMSender.sol` — on the agent's L1, sends a
  payment intent `(serviceId, payTo, amount, buyer)` to the destination L1 via
  `TeleporterMessenger.sendCrossChainMessage`.
- `contracts/contracts/icm/ChainPeICMReceiver.sol` — on the service's L1, the
  Teleporter relayer delivers the message; the receiver decodes + records it and
  emits `CrossChainPaymentIntent`. Only the local messenger can deliver (auth'd).

The interfaces match the canonical `TeleporterMessenger`
(`0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf`, same address on every ICM-enabled
L1), so these deploy as-is. Covered by `contracts/test/ChainPeICM.test.ts`
(a `MockTeleporterMessenger` simulates relayer delivery; 3 tests).

```bash
cd contracts && npm run deploy:icm:avalanche   # receiver on dest L1, sender on source L1
```

This is why **deterministic finality** matters again: ICM message verification
relies on the source L1's finalized state, which Avalanche provides in ~1–2s.

## Reproduce

```bash
node examples/avalanche-bench/bench.mjs                   # mainnet, defaults
GAS_PRICE_GWEI=25 AVAX_USD=45 node examples/avalanche-bench/bench.mjs
CHAINPE_NETWORK=fuji node examples/avalanche-bench/bench.mjs  # opt-in for Fuji testnet
```
