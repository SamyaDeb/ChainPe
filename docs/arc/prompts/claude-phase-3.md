You are a senior EVM smart-contract and x402 payments engineer continuing the ChainPe → Arc port.
Phases 1–2 are done and reviewed. Phase 3 = the on-chain provider accounts contract `ChainPeAccounts`
on Arc testnet, written, tested and deployed THROUGH ARC STUDIO (the prize requires Studio; judges
will open the Studio workspace), then independently reviewed and reproduced locally by you.
Money and access control must be correct; Studio output is untrusted until you have reviewed it.

Read first: CLAUDE.md, docs/arc/BUILD-PLAN.md (Phase 3), docs/arc/ARC-STUDIO.md (run 1),
docs/arc/specs/06-provider-accounts.md, docs/arc/specs/10-erc8004-identity.md,
docs/arc/prompts/studio-01-contracts.md, docs/arc/STUDIO-LOG.md, and `arc-studio agent-guide`.
Use the arc-docs MCP for Arc facts.

State (verified)
- Branch `arc`. CLI is Arc-only, version 3.0.0-arc.0. x402 v2 with a RailRouter: exact via Circle
  Facilitator (keyless, SettlementGuard) + Gateway (GatewayGuard, forwards on accepted). tsc passes.
- Live on Arc testnet: exact tx 0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9,
  Gateway transfer 393435a2-78e7-45c3-bfd8-9f85d7b87930 (batch tx 0xccffd62c…1ab6), deposit tx 0x5c05705f…cb81.
- Open from Phase 2: `chainpe withdraw` never completed — Gateway required 0.0045 available to withdraw
  0.001 (fee ≈ 0.0035 USDC on top of the amount).

PART C — Phase 2 carry-overs (one commit each, prefix `arc:`)
C1. Withdraw UX: before calling GatewayClient.withdraw, read available balance; if the SDK exposes the fee
    use it, else catch the "available X, required Y" error and print: "Withdrawal needs Y USDC available
    (amount + fee). Available: X." Add `--all` = withdraw (available − fee) when the fee is known.
    Live test: seller `chainpe deposit 0.01` into its own Gateway balance (or enough paid calls), then
    `chainpe withdraw 0.001` → print mintTxHash + explorer link. Record the result in spec 03a "Live results".
C2. Proof file: create docs/arc/PROOF.md — a table of every live Arc testnet artefact so far (date IST,
    what, tx/transfer id, explorer link). Keep appending in later phases. Judges read this.

PART D — Phase 3: ChainPeAccounts via Arc Studio

D0. Preflight (stop and tell me if any fails; I will fix auth myself):
    arc-studio --version ; arc-studio doctor ; arc-studio usage --json ; arc-studio apps --json
    Run Studio commands from the repo root so the app binds to this directory.
    Check the deployer: Studio deploys with its own testnet deployer unless told otherwise — find out from
    agent-guide and tell me which address deploys and who becomes `owner`/`treasury`. The owner MUST be
    a wallet I control (my deployer address — ask me for it; never request or send private keys to Studio).
    If Studio cannot deploy with owner = my address, the constructor must take `initialOwner` and you
    deploy owner = my address; treasury = my address too.

D1. Spec check before spending Studio budget (write findings into spec 06, commit):
    a. Confirm the Arc testnet ERC-8004 IdentityRegistry 0x8004A818BFB912233c491871b3d84c89A494BD9e is
       ERC-721 with ownerOf(uint256) (eth_call it on https://rpc.testnet.arc.io with a known agentId or
       read the verified source via explorer/arc-docs). If not, adjust the agentId ownership check.
    b. Pro price on testnet: check how much USDC the faucet gives per request. If 19 USDC is impractical
       for a demo subscribe, deploy testnet with proPricePerPeriod = 1_000_000 (1 USDC) and document
       "mainnet 19 USDC" in spec 06 and BUSINESS-MODEL.md. Update studio-01-contracts.md accordingly.
    c. Tighten spec 06 where it is ambiguous, then mirror the same rules into studio-01-contracts.md:
       - deactivateService decrements activeServices; re-registering a deactivated name reactivates the
         same key (no duplicate keys, no orphaned entries) and counts against maxServices.
       - Downgrade after Pro expiry: existing active services stay active; only NEW registrations are
         limited (document this choice).
       - paidUntil stays uint64; periods 1..12; subscribe uses SafeERC20 and follows checks-effects-
         interactions (state update before transferFrom is fine because USDC is not reentrant, but keep
         nonReentrant anyway).
       - pause blocks register/update/deactivate/subscribe; views and owner functions still work.
       - getServices(offset, limit) caps limit at 100; servicesOf returns keys only.
       - Constructor: (IERC20 usdc, address treasury, address identityRegistry, uint256 proPricePerPeriod,
         address initialOwner); all non-zero.

D2. Studio run 1 (contracts + tests + deploy):
      arc-studio run --prompt-file docs/arc/prompts/studio-01-contracts.md \
        --file docs/arc/specs/06-provider-accounts.md \
        --file contracts/contracts/ChainPeRegistryUpgradeable.sol \
        --output json > .arc-studio/run1.json
    (Skip PolicyVault for now — Task 4 in the prompt stays optional.) Handle the result document:
    - status needs_input → answer only from the specs via --answers-json; if the specs don't answer it,
      stop and ask me. budget_exceeded → stop and report `arc-studio usage --json`. error → report.
    - Read fileDiffs before pulling. Save webUrl, traceId, deployments. Never pass .env or keys.

D3. Pull and reproduce locally:
      arc-studio pull --changed --dry-run --diff
      arc-studio pull --out contracts-arc --paths "contracts/**"
      arc-studio pull --out contracts-arc --paths "test/**"
      arc-studio pull --out contracts-arc --paths "abi/**"
    Make contracts-arc a standalone Foundry project (foundry.toml, remappings for OpenZeppelin v5 pinned
    to the same version Studio used, .gitignore for out/ cache/ lib/ if installed via forge). Run
    `forge build` and `forge test -vv` locally and show the output. If Foundry is missing, tell me the
    one install command and continue with the rest.

D4. Your independent security review (write docs/arc/reviews/chainpe-accounts-review.md):
    access control (Ownable2Step, onlyOwner set), custom errors, input validation and string bounds,
    key derivation collisions (abi.encode vs encodePacked), activeServices accounting across
    register/deactivate/reactivate/update, plan limit bypasses (e.g. update toggling active), subscribe
    math (price * periods overflow, paidUntil extension from max(now, paidUntil)), USDC decimals (6, ERC-20
    interface; never native 18), zero-address handling (Arc reverts sends to address(0)), pause coverage,
    event completeness for the indexer in spec 08, unbounded loops, gas. Severity per finding.
    Add Foundry tests for anything untested (fuzz price*periods and paidUntil stacking; invariant:
    activeServices == number of active services per provider).

D5. Fix loop through Studio (so the deployed contract and the Studio workspace stay the source of truth):
    if any High/Medium finding, round-trip the files:
      arc-studio run --prompt-file <a short fix prompt you write in docs/arc/prompts/studio-01b-fixes.md> \
        --file contracts-arc/src/ChainPeAccounts.sol:contracts/ChainPeAccounts.sol \
        --file contracts-arc/test/ChainPeAccounts.t.sol:test/ChainPeAccounts.t.sol \
        --output json > .arc-studio/run1b.json
    asking Studio to apply exactly your fixes, run tests, and redeploy. Pull again, re-run forge test.
    Repeat until no High/Medium remains. (Adjust local paths to match what D3 produced.)

D6. Verify the deployment on-chain yourself (viem script in contracts-arc/script/verify-deploy.ts or cast):
    eth_getCode non-empty; usdc() == 0x3600…0000; identityRegistry() == 0x8004A818…BD9e; treasury and owner
    == my address; proPricePerPeriod as decided; PERIOD == 30 days. Check whether the source is verified on
    https://explorer.testnet.arc.io; if not, verify it (Blockscout API / forge verify-contract) and say how.

D7. On-chain smoke test from local wallets (seller key from .env, buyer key for a second provider):
    registerProvider(0) → registerService(demo weather service, network "eip155:5042002",
    acceptsExact true, acceptsGateway true) → second registerService on Free reverts → approve + subscribe(1)
    → planOf == 1 → registerService works → deactivateService. Print every tx with explorer links and
    append them to docs/arc/PROOF.md.

D8. Wire-up for Phase 4 (no CLI command changes yet):
    - contracts-arc/deployments/arc-testnet.json {address, txHash, block, deployer, owner, treasury,
      proPricePerPeriod, studio: {webUrl, traceId}}.
    - packages/chainpe/src/abi/ChainPeAccounts.ts exporting the ABI `as const`, and
      `accountsAddress` per network in chains.ts (arc-testnet = deployed address, arc = undefined).
    - CHAINPE_ACCOUNTS_ADDRESS in .env.example; address in docs/arc/ARCHITECTURE.md §4.
    - docs/arc/STUDIO-LOG.md: fill run 1 (and 1b) rows; paste the `arc-studio open` workspace URL at the top.

Tests to show me: forge test (local) green, tsc --noEmit green for packages/chainpe, the D6 checks, and
the D7 transactions. npm test runs on my Mac (native rollup is darwin) — tell me to run it.

Rules
- Studio only receives specs, the prompt file and contract sources — never .env, keys, or the monorepo.
- Do not change packages other than adding the ABI/address in D8 (CLI commands are Phase 4).
- No mainnet deploy in this phase.
- If Studio's output conflicts with the spec, the spec wins unless you show me why the spec is wrong.
- Stop and ask me when: owner/treasury cannot be my address, the faucet can't fund the smoke test, or a
  Studio run needs input the specs don't cover.

Report at the end: C1/C2 results, D1 decisions, Studio runs (status, webUrl, traceId, deployments),
review findings and fixes, local test output, D6 checks, D7 tx links, files changed, commits, and open
items for Phase 4.
