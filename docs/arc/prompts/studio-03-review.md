Review pass on this project (ChainPe on Arc).

1. Contracts: review contracts/ChainPeAccounts.sol (and contracts/PolicyVault.sol if present) for
   access control, reentrancy, integer and decimals mistakes (USDC ERC-20 has 6 decimals on Arc; native
   is 18), zero-address handling (Arc reverts sends to address(0)), event completeness, and gas. List
   findings by severity, fix anything High or Medium, add a regression test for each fix, and re-run all
   Foundry tests. Do not redeploy unless a fix changes behaviour; if it does, redeploy to Arc testnet and
   report the new address.
2. Dashboard: check every screen with mock data (VITE_USE_MOCK=true) at 375px and 1280px wide, light and
   dark. Fix layout overflow, unreadable contrast, missing empty/loading/error states, and any place an
   amount is not formatted per the rules in context/docs/arc/specs/07-provider-dashboard.md.
3. Report: a short list of what you changed and what remains.
