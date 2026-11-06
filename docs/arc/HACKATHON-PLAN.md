# Hackathon plan

Goal: one full story working on Arc testnet. A developer puts a price on an API, Claude finds it and pays for it on
Arc, and the revenue shows on the dashboard. Mainnet comes after the hackathon.

Phases are numbered H1 to H8, so they don't clash with the phases in [BUILD-PLAN.md](BUILD-PLAN.md). Each phase ends
with a check that must pass before the next one starts. Publishing or deprecating an npm package needs the owner's OK
at each step: it is public, and a published version number can't be reused. No package is published until it is free of
Avax names and Avalanche code, because the published packages are Arc-only and named ChainPe.

## H1: Clean-up and safety

Public pages tell the truth, the name is ChainPe everywhere, and nobody takes real money by accident.

| Task | Who |
|---|---|
| Rename to ChainPe everywhere: repo links, package metadata, and no Avax name in anything published | Claude Code |
| Replace `TODO(dashboard-url)`, and update `SUBMISSION.md` and `BUILD-PLAN.md` | Claude Code |
| Reword the fee copy as the business model, not yet live, then redeploy the landing page | Claude Code |
| Mark the hosted docs as describing the June Avalanche version until they are rewritten for Arc | Claude Code |
| Make `chainpe start` on Arc mainnet require an explicit flag | Claude Code |
| Run `chainpe doctor`, then submit the Circle form ([LISTING.md](LISTING.md)) | Owner |
| Make the Arc Studio workspace viewable by judges | Owner |

**Done when:** no public page shows a TODO or a false claim, no package would ship an Avax name, and `chainpe start`
refuses Arc mainnet without the flag.

## H2: Provider onboarding

A developer can go from install to a working setup without help.

- Make `chainpe login` use the production cloud URL by default.
- Make `chainpe init` generate `routes`, so the OpenAPI check can pass.
- Make `chainpe doctor` print the values for Circle's form.
- Add a short guide to the README covering public HTTPS hosting, key safety and `chainpe login`.
- Publish `chainpe` 3.0.0, then deprecate `@chainpeavax/cli`.

**Done when:** on a clean machine, `npm install -g chainpe` works, `doctor` is green, and a paid call appears on the
dashboard.

## H3: Buyer SDK on Arc (spec 09)

Agents can pay on Arc through ChainPe's own code.

- Add `arc` and `arc-testnet` to `chainpe-sdk`, default to testnet, and remove Avalanche from the package and its metadata.
- Support both payment options, and keep the spending limits.
- Add `balance()`, `depositGateway()` and `giveFeedback()`.
- Make `discover()` search Circle's Discovery API, then fall back to `ChainPeAccounts`.
- Connect `chainpe discover` to the same search.
- Publish `chainpe-sdk`, then deprecate `@chainpeavax/sdk`.

**Done when:** a short script finds the demo API, pays it both ways and leaves a rating on testnet.

## H4: Claude pays through the MCP wallet (the main demo)

Claude finds a service, pays for it and rates it.

- Allow `arc` and `arc-testnet` in the wallet's network config.
- Move payment, balance, discovery and rating onto the new SDK.
- Remove Avalanche and the AVAX transfer tool from the package and its metadata, and show gas in USDC.
- Publish `chainpe-wallet-mcp`.

**Done when:** Claude pays the demo API on both options and its rating shows on the dashboard. This also meets the
Phase 7 check in [BUILD-PLAN.md](BUILD-PLAN.md).

## H5: Proof

Evidence from real use, not just our own wallets.

| Task | Who |
|---|---|
| Run the 10 paid calls ([PAID-CALLS-RUNBOOK.md](PAID-CALLS-RUNBOOK.md)) | Owner |
| Get one friend through [TRY-IT.md](TRY-IT.md) using the npm package | Owner |
| Add both to [PROOF.md](PROOF.md) | Claude Code |
| Rerun all tests and `chainpe doctor --pay` | Claude Code, with the buyer key set by the owner |

**Done when:** `PROOF.md` shows at least 10 calls and one outside wallet.

## H6: Submit

| Task | Who |
|---|---|
| Update the README, commit count and architecture diagram | Claude Code |
| Merge `arc` into `main` without squashing | Claude Code |
| Update [DEMO-SCRIPT.md](DEMO-SCRIPT.md) for the Claude flow | Claude Code |
| Record the video | Owner |
| Submit on ETHGlobal and name the prize | Owner |

**Done when:** the submission is in, and a judge opening the repo sees the Arc README first.

## H7: Stretch goals, only after H6 is safe

1. **MCP monetization:** free `initialize` and `tools/list`, per-tool prices, a streaming test, and a way to serve stdio servers over HTTP.
2. **`ChainPeFees`:** build it in Arc Studio, deploy it to testnet, and turn the fee on.
3. **Remaining packages:** move `chainpe-ai-tools` and `chainpe-agent` to Arc, remove Avalanche from them, publish them, and deprecate their old names.

## H8: Mainnet, after the hackathon

1. Get a production Circle API key.
2. Review the contracts and the payment path independently.
3. Deploy `ChainPeAccounts` and `ChainPeFees` to mainnet.
4. Add mainnet to the cloud indexer and dashboard.
5. Make one real small payment, then remove the guard.

## If time runs short

Protect H1, H4, H5 and H6, in that order. The minimum for H2 and H3 is publishing `chainpe` and the SDK work the wallet
depends on. Skip the rating step first if time is very short.
