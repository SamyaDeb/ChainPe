# ChainPe — gasless, policy-bounded agent spending (the "wow")

An owner sets **on-chain spending limits**; their agent spends **gaslessly**
within them; the **chain blocks an overspend**. Built on `PolicyVault`
(`contracts/contracts/PolicyVault.sol`) + the `@chainpe/sdk` `PolicyVaultClient`
— a non-4337 approach to gasless agent spending.

```
owner ──deposit USDC + setPolicy(sessionKey, caps)──▶ PolicyVault
agent (session key) ──signs spend (EIP-712, no gas)──▶ relayer ──spend(...)──▶ vault
                                                          releases USDC if within policy,
                                                          REVERTS if over-cap / revoked
```

## Why it matters

- **Gasless:** the agent only signs; a relayer (or the ChainPe facilitator)
  submits and pays AVAX. The agent never holds gas.
- **On-chain guardrails:** `maxPerCall`, `dailyCap`, `totalBudget`, `expiry`, and
  an optional recipient allowlist — all enforced in the contract.
- **Revocable:** the owner can kill the session key instantly.

## Run

```bash
# 1. Deploy a vault (once)
cd ../../contracts && npm run deploy:policyvault   # → VAULT_ADDRESS

# 2. Configure + run the demo
cd ../examples/policy-vault
cp .env.example .env      # VAULT_ADDRESS + 3 distinct keys + RECIPIENT
npm install
npm run demo
```

You'll see: a 0.5 USDC spend settle gaslessly, a 2 USDC spend **rejected
on-chain** (over the 1 USDC per-call cap), and another rejected after the owner
revokes the session — each visible on Snowtrace.

> Needs: the OWNER wallet funded with USDC (to deposit) + AVAX (setup gas); the
> RELAYER funded with AVAX (submission gas); the SESSION key needs nothing.
> ERC-8004-style separation: keep the three keys distinct.
