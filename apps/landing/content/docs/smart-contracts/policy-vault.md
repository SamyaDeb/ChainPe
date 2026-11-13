---
id: smart-contracts-policy-vault
title: PolicyVault
sidebar_position: 3
---

# PolicyVault

Programmable, gasless spending policies for agent payments in USDC.

**Solidity:** `contracts/contracts/PolicyVault.sol`
**Inherits:** `EIP712("ChainPePolicyVault", "1")`, `ReentrancyGuard`, `Ownable`, `Pausable`

:::note
PolicyVault is deployed on Avalanche C-Chain mainnet at proxy address [`0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`](https://snowtrace.io/address/0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8).
:::

## Purpose

An owner deposits USDC and grants a scoped session key a policy: per-call cap, daily cap, total budget, expiry, and optional recipient allowlist. The agent signs spend authorizations (EIP-712) off-chain; any relayer submits `spend()` and pays gas. Every constraint is enforced on-chain.

## State variables

| Variable | Type | Description |
|---|---|---|
| `token` | `IERC20` (`immutable`) | The USDC contract address |
| `balanceOf` | `mapping(address => uint256)` | USDC vault balance per owner |
| `policyOf` | `mapping(address => Policy)` | Active policy per owner |
| `allowlist` | `mapping(address => mapping(address => bool))` | Approved recipients per owner |
| `totalSpent` | `mapping(address => uint256)` | Lifetime spend per owner (resets on new session) |
| `dailySpent` | `mapping(address => mapping(uint256 => uint256))` | Spend per owner per UTC day |
| `nonces` | `mapping(address => uint256)` | Spend nonce for replay protection |

## Policy struct

```solidity
struct Policy {
    address sessionKey;   // scoped signer (the agent)
    uint256 maxPerCall;   // max USDC per spend
    uint256 dailyCap;     // max USDC per UTC day (must be > 0)
    uint256 totalBudget;  // lifetime cap for this session
    uint64 expiry;        // unix timestamp
    bool allowlistOnly;   // if true, `to` must be in allowlist
    bool active;          // false after revokeSession()
}
```

## EIP-712 typehash

```solidity
// DO NOT CHANGE — invalidates all existing authorizations
bytes32 private constant SPEND_TYPEHASH =
    keccak256("Spend(address owner,address to,uint256 amount,uint256 nonce,uint256 deadline)");
```

## Functions

### `deposit(uint256 amount)`

Deposits USDC into the caller's vault (must approve first).

**Modifiers:** `nonReentrant`, `whenNotPaused`
**Events:** `Deposited(owner, amount)`

### `withdraw(uint256 amount)`

Withdraws USDC back to the caller.

**Modifiers:** `nonReentrant`, `whenNotPaused`
**Reverts:** `"insufficient balance"`
**Events:** `Withdrawn(owner, amount)`

### `setPolicy(address sessionKey, uint256 maxPerCall, uint256 dailyCap, uint256 totalBudget, uint64 expiry, bool allowlistOnly)`

Sets or replaces the spending policy. Resets `totalSpent` to zero.

**Reverts:**
- `"sessionKey=0"` — zero address
- `"dailyCap=0"` — daily cap must be > 0
- `"maxPerCall>totalBudget"` — single call cap must fit in total budget
- `"expiry in past"` — expiry must be in the future

**Events:** `PolicySet(owner, sessionKey, maxPerCall, dailyCap, totalBudget, expiry, allowlistOnly)`

### `setAllowlist(address to, bool allowed)`

Adds or removes a recipient from the owner's allowlist.

**Events:** `AllowlistUpdated(owner, to, allowed)`

### `revokeSession()`

Sets `policy.active = false`. Future `spend()` calls revert.

**Events:** `SessionRevoked(owner, sessionKey)`

### `spend(address owner, address to, uint256 amount, uint256 deadline, bytes sessionSig)`

Releases USDC from `owner`'s vault to `to`. Called by relayer (pays gas).

**Modifiers:** `nonReentrant`, `whenNotPaused`

**Checks (in order):**
1. `policy.active == true`
2. `block.timestamp <= policy.expiry`
3. `block.timestamp <= deadline`
4. `to != address(0)`
5. `amount > 0`
6. `amount <= policy.maxPerCall`
7. `balanceOf[owner] >= amount`
8. `totalSpent[owner] + amount <= policy.totalBudget`
9. `dailySpent[owner][today] + amount <= policy.dailyCap`
10. If `allowlistOnly`: `allowlist[owner][to] == true`
11. `ECDSA.recover(digest, sessionSig) == policy.sessionKey`

**Events:** `Spent(owner, to, amount, relayer, nonce)`

### `previewSpend(address owner, address to, uint256 amount) → (bool ok, string reason)`

Simulates a spend check. Does NOT verify the signature. Useful for off-chain agents to check before signing.

```solidity
(bool ok, string memory reason) = vault.previewSpend(owner, to, amount);
if (!ok) revert(reason);  // e.g. "over per-call cap"
```

### `dailyRemaining(address owner) → uint256`

USDC still spendable today under the daily cap (in atomic units).

### `budgetRemaining(address owner) → uint256`

USDC still spendable under the session's lifetime budget.

### `cleanupDailySpent(address owner, uint256[] dayIndices)`

Deletes stale daily-spend slots to reclaim storage gas. Any caller can invoke. Cannot clear the current day.

### `domainSeparator() → bytes32`

Returns the EIP-712 domain separator. Useful for off-chain signers.

### Admin functions (owner only)

| Function | Description |
|---|---|
| `pause()` | Pause deposit/spend/withdraw |
| `unpause()` | Resume operations |

## Events

```solidity
event Deposited(address indexed owner, uint256 amount);
event Withdrawn(address indexed owner, uint256 amount);
event PolicySet(address indexed owner, address indexed sessionKey, uint256 maxPerCall,
    uint256 dailyCap, uint256 totalBudget, uint64 expiry, bool allowlistOnly);
event AllowlistUpdated(address indexed owner, address indexed to, bool allowed);
event SessionRevoked(address indexed owner, address indexed sessionKey);
event Spent(address indexed owner, address indexed to, uint256 amount,
    address indexed relayer, uint256 nonce);
```

## EIP-712 domain

```json
{
  "name": "ChainPePolicyVault",
  "version": "1",
  "chainId": 43114,
  "verifyingContract": "0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8"
}
```

Types:
```json
{
  "Spend": [
    { "name": "owner", "type": "address" },
    { "name": "to", "type": "address" },
    { "name": "amount", "type": "uint256" },
    { "name": "nonce", "type": "uint256" },
    { "name": "deadline", "type": "uint256" }
  ]
}
```
