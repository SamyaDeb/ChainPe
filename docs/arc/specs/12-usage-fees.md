# Spec 12: usage fee on verified calls

**Status: `ChainPeFees` is deployed on Arc testnet at `0x09c85EEdeF018274861aae0964f9681C11f91Af4`, source verified. Charging is opt-in: `FEES_START_AT` is unset, so only a provider who approves an allowance in Billing is charged.**

ChainPe takes a percentage of the verified revenue of each provider who opts in. This replaces "no cut of payments".

## Why the fee is not taken at the moment of payment

The buyer signs one EIP-3009 transfer to one address, and Circle settles that transfer. We found no split or platform
fee option in Circle's or x402's docs. A splitter contract as `payTo` does not work: Circle's nanopayments need EOA
signatures, not ERC-1271, and `ChainPeAccounts` requires `payTo` to be the wallet that registers the service. So the
buyer still pays the provider directly, and the fee is collected from the provider afterwards.

## Rates and limits

| Setting | Value | Where |
|---|---|---|
| Free plan rate | 1% (100 bps) | `FEE_BPS_FREE` |
| Pro plan rate | 0.5% (50 bps) | `FEE_BPS_PRO` |
| Highest rate the contract accepts | 5% (500 bps) | `MAX_FEE_BPS`, a constant in `ChainPeFees` |
| Collect at | 1 USDC owed | `FEE_COLLECT_AT_ATOMIC` |
| Or collect once a day, from | 0.05 USDC owed | `FEE_COLLECT_MIN_ATOMIC` |
| Lock the dashboard at | 5 USDC owed | `FEE_LOCK_AT_ATOMIC` |

## What is charged

A call accrues a fee when its payment is `completed`, `verified` and not self-pay, and, on Gateway, when its batch has
landed (`completed` on Circle's record). The fee is `floor(amount * bps / 10000)`, in atomic USDC, at the provider's plan
when the fee is recorded. An uncollected fee is dropped if its payment stops qualifying, for example when the payer is
added to "my wallets". A fee already collected is not refunded automatically.

## Who is charged

- A provider is charged from the moment the service first sees an allowance to `ChainPeFees`: the dashboard's reload right after an approval, or a later fee run. Approving is the opt-in.
- Revoking stops collection, not the charge. Fees on new calls are still recorded and count toward the lock. A provider stops being charged by no longer reporting calls.
- `FEES_START_AT` is optional. When set, a provider registered at or after that time is charged from then on without
  opting in. Leave it unset until the public copy says ChainPe takes a fee.

## Contract: `ChainPeFees`

`collect(provider, revenueAtomic, feeAtomic, batchId)`, callable only by the collector:

- Refuses a fee above `MAX_FEE_BPS` of the stated revenue, a repeated `batchId`, and a zero fee.
- Moves USDC from the provider's allowance to the treasury. It never holds funds.
- Emits `FeeCollected`, so anyone can audit the stated revenue against the provider's payments.

**The rate limit is only as honest as the stated revenue**, which the collector supplies. The real limit on what can be
taken is the allowance the provider sets, and a provider can revoke it at any time.

## Enforcement and its limit

Owed fees at or above the lock level make the dashboard's data endpoints answer `403 fees_due`. `/v1/me`, `/v1/me/fees`,
`/v1/keys` and ingest stay open, so a provider can pay and their proxy keeps reporting. **A provider's API and paid calls
are never blocked.** The proxy is open source, so a provider can fork it or use `--no-telemetry` and pay nothing. They lose
verified revenue and the dashboard. The fee cannot be enforced on-chain.

## Secrets

`FEE_COLLECTOR_PRIVATE_KEY` is a Railway variable on `chainpe-cloud`. The collector can only call `collect`, needs USDC for
gas, and holds nothing else. Without the key the service records fees but collects none.
