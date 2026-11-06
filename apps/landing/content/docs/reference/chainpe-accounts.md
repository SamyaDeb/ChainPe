---
title: ChainPeAccounts
description: The contract for provider accounts, service listings and the Pro plan.
---

`ChainPeAccounts` holds provider accounts, service listings and a Pro plan paid in USDC. It was built, tested and deployed with [Arc Studio](https://studio.arc.io), and isn't upgradeable.

| | |
|---|---|
| Address (Arc testnet) | [`0xD315322c9D83A6f50A04236A2a242e0259bfB580`](https://explorer.testnet.arc.io/address/0xD315322c9D83A6f50A04236A2a242e0259bfB580) |
| Source | [`contracts-arc/contracts/ChainPeAccounts.sol`](https://github.com/SamyaDeb/ChainPe/blob/arc/contracts-arc/contracts/ChainPeAccounts.sol) |
| ABI | [`contracts-arc/abi/ChainPeAccounts.json`](https://github.com/SamyaDeb/ChainPe/blob/arc/contracts-arc/abi/ChainPeAccounts.json) |
| Tests | 101 (93 unit, plus 8 fuzz and invariant) |
| Review | [Security review](https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/reviews/chainpe-accounts-review.md) |
| Pro price | 1 USDC per 30 days on testnet |

## Provider functions

| Function | What it does |
|---|---|
| `registerProvider(uint256 agentId)` | Creates your account |
| `setAgentId(uint256 agentId)` | Changes your ERC-8004 identity |
| `registerService(ServiceInput)` | Registers a service, or reactivates an inactive one, and returns its key |
| `updateService(ServiceInput)` | Updates a service |
| `deactivateService(string name)` | Deactivates a service |
| `subscribe(uint8 periods)` | Pays for 1 to 12 periods of Pro, in USDC |

These revert while the contract is paused.

## Views

| Function | Returns |
|---|---|
| `providers(address)` | The provider's account |
| `planOf(address)` | 1 for Pro, 0 for Free |
| `maxServices(address)` | 1 on Free, 10 on Pro |
| `getService(bytes32)` | One service |
| `getServices(uint256 offset, uint256 limit)` | A page of services, up to 100 |
| `servicesOf(address)` | The provider's service keys |
| `serviceCount()` | The number of services |
| `computeKey(address, string)` | A service key |

## Service input

```solidity
struct ServiceInput {
    string name;
    string description;
    string tags;
    string endpoint;
    string pricePerRequest;
    string network;
    address payTo;
    bool acceptsExact;
    bool acceptsGateway;
}
```

## Behaviour

- A service key is `keccak256(abi.encode(provider, name))`.
- `payTo` is checked against the sender, so a provider can't list another wallet as its payee.
- A service must accept at least one payment rail.
- Reactivating a service keeps its key and creation time, and counts against the plan limit.
- When Pro expires, active services stay active. Only new registrations and reactivations are limited.
- `agentId` 0 means no identity.

## Owner functions

`setProPrice`, `setTreasury`, `pause` and `unpause`. Ownership moves in two steps, and `renounceOwnership` always reverts.
