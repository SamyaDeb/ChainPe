# README check (2026-11-06, about 11:30 IST)

Every link and number in the root `README.md`, checked live in a browser or on disk.

## Links

| Link | Result |
|---|---|
| All 14 repo-relative links (`docs/arc/*`, `docs/avalanche/README.md`, `LICENSE`) | OK, files exist |
| https://chainpe-arc-demo-production.up.railway.app | OK. `/health` 200; `/forecast` answers 402 with two payment options |
| `.../forecast?city=Mumbai` (in the buyer example) | OK, 402 when unpaid (expected) |
| Explorer: ChainPeAccounts `0xD315…B580` | OK, Blockscout address page, source verified |
| Explorer: tx `0x11027eae…c6c9` (first exact payment) | OK |
| Explorer: tx `0xf7003065…1a52` (identity mint) | OK |
| https://github.com/SamyaDeb/ChainPeAvax/tree/avalanche-june-2026 | OK, the tag exists on GitHub |
| https://github.com/SamyaDeb/ChainPeAvax.git | OK (repo exists) |
| Snowtrace tx `0x953923f2…2006` (June payment) | Page loads |
| https://faucet.circle.com | OK |
| **https://studio.arc.io/app/6872b96e-…** | **Redirects to Circle login.** A judge without access may not see it. Check Studio's share settings before submitting |
| Provider dashboard | **TODO(dashboard-url)**, not deployed yet |
| shields.io badges | Static images |

## Numbers

| Number in README | Source |
|---|---|
| Agent 897796 | PROOF.md row "Demo seller ERC-8004 identity minted"; `ownerOf(897796)` = seller, checked on-chain |
| 101 contract tests | `grep -c "function test\|function invariant" contracts-arc/contracts/test/*.sol` |
| One Medium found and fixed | docs/arc/reviews/chainpe-accounts-review.md, finding M-1 |
| 19 USDC / 30 days (1 USDC on testnet) | BUSINESS-MODEL.md; `proPricePerPeriod()` = 1000000 on-chain |
| $0.001 per call on Gateway | examples/arc-demo/config.json `/weather` route; live 402 amount 1000 |
| 0.01 USDC June payment | docs/avalanche/README.md, June proof table |
| 79 commits | `git log --oneline avalanche-june-2026..arc`, run 2026-11-06 ~11:00 IST. Update before submitting |
