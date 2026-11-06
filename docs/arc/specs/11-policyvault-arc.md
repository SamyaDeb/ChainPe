# Spec 11 — PolicyVault on Arc (stretch)

**Goal:** show on-chain spending caps for buyer agents on Arc: an overspend reverts on-chain.

- Port `contracts/contracts/PolicyVaultUpgradeable.sol` logic to a non-upgradeable `PolicyVault.sol` in the
  same Arc Studio app as `ChainPeAccounts` (prompt `studio-01-contracts.md`, optional section).
- Token = Arc USDC ERC-20 `0x3600…0000` (6 decimals). Keep: `deposit`, `withdraw`, `setPolicy(sessionKey, maxPerCall, dailyCap, totalBudget, expiry, allowlistOnly)`,
  `setAllowlist`, `revokeSession`, `spend(owner, to, amount, deadline, sessionSig)` with EIP-712, `previewSpend`.
- Foundry tests: per-call cap, daily cap, total budget, expiry, allowlist, bad signature — each reverts with its custom error.

**Limitation to state in the demo:** Gateway nanopayments come from a pre-deposited Gateway balance and do not
pass through PolicyVault. Caps apply to vault-funded payments (exact rail via `spend` → payTo).

## Acceptance

- [ ] Deployed on Arc testnet via Studio; address in `STUDIO-LOG.md`.
- [ ] Demo: `previewSpend` says over cap; `spend` reverts on-chain with `OverDailyCap` (tx/trace shown).
