# ChainPeAccounts security review

Independent review of the contract Arc Studio wrote in run 1 (`0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb`), against
spec 06 and how specs 08 and 10 use it. Reviewed on 2026-11-06, from `contracts-arc/contracts/ChainPeAccounts.sol`.

**Current deployment:** `0xD315322c9D83a6f50A04236A2a242e0259bfB580` (run 1b). Its runtime bytecode is byte-identical to a local compile of the fixed
source, and the source is verified on the explorer.

**Result:** no High. One Medium (M-1), fixed through Studio in run 1b. Six Low and five Info items are accepted or
handed to later phases. No Lows were fixed, to keep the Studio round trip to the single required change.

| ID | Severity | Finding | Status |
|---|---|---|---|
| M-1 | Medium | `payTo` is not bound to the provider, so a provider can claim another wallet's revenue | Fixed, run 1b |
| L-1 | Low | `agentId` goes stale after the ERC-8004 token is transferred | Phase 4 and 5 must check `ownerOf` |
| L-2 | Low | Strings are unvalidated, so `endpoint` and `name` are untrusted input off-chain | Phase 5 and 6 must sanitise |
| L-3 | Low | `subscribe` has no maximum price, so a price rise can charge wallets with a large allowance | Accepted; CLI approves exactly |
| L-4 | Low | `setTreasury` accepts the contract's own address, which would lock later payments | Accepted, owner-only |
| L-5 | Low | A very high `setProPrice` makes `subscribe` revert until it is corrected | Accepted, owner-only |
| L-6 | Low | A full `getServices` page can be expensive to read | Accepted; use smaller pages |
| I-1 | Info | Token 0 exists on the registry but `0` means "no identity" | Documented in spec 06 |
| I-2 | Info | Service names are not normalised | Accepted |
| I-3 | Info | Free limit is per address, so several wallets can list several services | Accepted |
| I-4 | Info | USDC sent directly to the contract cannot be recovered | Accepted |
| I-5 | Info | Studio added a non-zero price check the spec did not ask for | Kept and added to spec 06 |

## Findings

### M-1: `payTo` is not bound to the provider (Medium, fixed)

`registerService` and `updateService` only required `payTo != 0`. Spec 08 treats `payTo` as proof of ownership: USDC
transfers are indexed when `to` is in the registered `payTo` set, and ingest rejects events "for a `payTo` the key's
provider doesn't own". A contract that records any `payTo` makes that check meaningless.

**Failure scenario.** A provider registers a service with `payTo` set to a competitor's seller wallet. Its ingest key
can then submit events for that wallet that quote the competitor's real transaction hashes. Those match
`onchain_transfers`, so they are marked `verified`, and the attacker's dashboard shows revenue it never earned plus
the competitor's buyers. That breaks the Phase 6 acceptance rule, and a provider could use the figures to mislead
anyone relying on "verified" revenue. Funds are not at risk, because buyers pay the address in the 402, not the listing.

**Fix.** Revert with `PayToNotSender` unless `payTo == msg.sender`, in both functions.

**Why this overrides spec 06.** The spec allowed any non-zero `payTo`, but no valid flow needs one that differs:
`resolveSellerKey` already refuses a seller key that does not control `payTo`, because Circle only settles to a
`payTo` the seller key controls, and `chainpe register` signs with that key. The field stays in the struct and events,
so the ABI and indexer are unaffected, and separate payout wallets can be added later with a signed consent.

### L-1: `agentId` goes stale (Low)

`ownerOf` is checked only when linking. After the ERC-8004 token moves, the old owner keeps the link, and several
providers can hold the same `agentId` by passing the token between wallets. They could then show reputation that is
not theirs. `Service.agentId` is also a snapshot. **Action:** Phase 4 `chainpe doctor` and Phase 5 `feedback` indexing
must confirm `ownerOf(agentId) == provider` before showing or using an `agentId`.

### L-2: Strings are untrusted (Low)

The contract bounds string lengths only. `endpoint` can be `javascript:…`, and `pricePerRequest` can be `"a1"` or
`"1.2.3"`, since the digit check is not a parser. An endpoint can also be someone else's URL, because the contract
cannot prove control of it. **Action:** Phase 5 parses prices and URLs defensively, Phase 6 only links `https:` URLs,
and any public listing proves endpoint control first (`chainpe doctor`).

### L-3: No maximum price on `subscribe` (Low)

`subscribe(uint8)` charges the current price, so an owner price rise applies to any wallet with a larger allowance.
The spec fixes this signature and the owner is trusted. **Action:** `chainpe upgrade` approves exactly
`price * periods` in Phase 4, never an unlimited allowance.

### L-4: Treasury can be the contract itself (Low)

`setTreasury(address(this))` would lock later payments, because the contract has no way to send USDC. Only a mistaken
owner can do this, and pointing the treasury elsewhere stops further loss.

### L-5: Very high price blocks `subscribe` (Low)

Overflow reverts safely (fuzz-tested). The effect is that nobody can subscribe until the owner corrects the price.

### L-6: `getServices` page cost (Low)

A page holds up to 100 full structs with up to about 1.6 KB of strings each, which may exceed some RPC `eth_call` gas
caps. It is a read only and does not affect state. **Action:** Phase 5 reads in smaller pages or uses events.

### I-1 to I-5

- **I-1:** `ownerOf(0)` returns an owner on Arc testnet, but `0` means "no identity", so token 0 cannot be linked.
- **I-2:** `"weather"`, `"Weather"` and look-alike Unicode names are separate keys. Each still counts against the limit.
- **I-3:** A wallet per service avoids the Free limit. Registration is free, so this cannot be prevented on-chain.
- **I-4:** There is no rescue function. It was left out on purpose: less owner power on a non-upgradeable contract.
- **I-5:** `_requireNonzeroPrice` rejects `"0"` and `"0.00"`. It is compatible with the spec, since x402 needs a real
  price, so it was kept.

## Checked with no finding

| Area | Result |
|---|---|
| Access control | `Ownable2Step`; `onlyOwner` on exactly `setProPrice`, `setTreasury`, `pause`, `unpause`; owner is `initialOwner`, not the deployer; `renounceOwnership` always reverts |
| Custom errors | Used throughout; no revert strings |
| Input bounds | All six strings bounded as specified, at the exact limits (tested); at least one rail required |
| Key derivation | `keccak256(abi.encode(provider, name))`; `abi.encode` length-prefixes, so no `encodePacked` collisions; provider-scoped, so nobody can reach another provider's key |
| `activeServices` | Register +1, reactivate +1, deactivate −1, update unchanged; held under the invariant suite |
| Plan limit bypass | `ServiceInput` has no `active`; update requires an active service and cannot toggle it; reactivation counts against the limit; expiry limits only new registrations, as specified |
| Subscribe math | Checked multiplication; `max(now, paidUntil)` extension; `SafeCast` to `uint64`; state update before `safeTransferFrom`, plus `nonReentrant` |
| USDC units | Uses the ERC-20 interface only, with atomic 6-decimal amounts; nothing payable and no native USDC handling |
| Zero address | Constructor, `setTreasury`, `payTo` all rejected; `treasury` never zero, so no send reverts on Arc for that reason |
| Pause | On all six provider writes; views and owner functions work while paused |
| Reentrancy | Only outside calls are `ownerOf` (staticcall) and USDC `transferFrom` (last, guarded) |
| Events | Carry everything the spec 08 `providers`, `services` and `subscriptions` tables store; reactivation emits `ServiceRegistered`; `description` and `tags` are read with `getService` |
| Loops | Only `getServices` (capped at 100) and short bounded string checks; `servicesOf` returns a list that Free or Pro limits do not cap, but it is a read only |
| Identity registry | Arc testnet registry is ERC-721 with `ownerOf` (spec 06) |

## Tests

Studio's suite has 90 tests and 100% line and branch coverage of the contract, but only one fuzz test and no
invariants. Added `contracts/test/ChainPeAccounts.invariant.t.sol`:

- **Invariants (256 runs, 128,000 calls each):** `activeServices` equals the active count per provider; keys are
  unique; all payments reach the treasury; `paidUntil` changes only through `subscribe`.
- **Fuzz (256 runs each):** `price * periods` is exact; overflow reverts and takes no funds; `paidUntil` stacks across
  gaps; a lapsed plan restarts from now.

The invariants were mutation-tested on a scratch copy. Removing the decrement in `deactivateService` failed the
`activeServices` invariant, and pushing the key again on reactivation failed the `activeServices` and uniqueness ones.

## Limits of this review

One reviewer, not a professional audit. Mock USDC and identity contracts were used in Foundry, so real USDC and
registry behaviour is covered only by the on-chain smoke test.
