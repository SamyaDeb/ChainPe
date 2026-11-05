# ChainPeAccounts

Provider accounts, service listings and a USDC-paid Pro plan for ChainPe on Arc.
Non-upgradeable. Built with Ownable2Step, Pausable, ReentrancyGuard, SafeERC20 and SafeCast.

Built with [Arc Studio](https://studio.arc.io)

Source: `contracts/ChainPeAccounts.sol` · Tests: `contracts/test/ChainPeAccounts.t.sol` (90 passing) · ABI: `abi/ChainPeAccounts.json`

## Deployment (Arc testnet, chain ID 5042002)

| | |
|---|---|
| Contract | `0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb` |
| Explorer | https://explorer.testnet.arc.io/address/0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb |
| Deploy tx | `0x346e9bc5e3524fb0b0ccc6bd0b845dab67927775d866f36367b3758ad2b3f430` |
| Deployed by | Arc Studio platform deployer smart account `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (submitted as a user operation by `0x927e53dd99d5042459ae15e72b4e933d1f08764e` through EntryPoint `0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789`) |
| Owner | `0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a` (set explicitly; the deployer holds no rights) |
| Treasury | `0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a` |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Identity registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` (ERC-8004) |
| Pro price | `1000000` (1 USDC) per 30-day period |

No function was called after deployment. Constructor values were read back from the chain and match.

Build settings: solc `0.8.28+commit.7893614a`, optimizer enabled with 200 runs, EVM `cancun`, no via-IR, OpenZeppelin Contracts `5.6.1`.

## Functions

Providers (all `whenNotPaused`):
- `registerProvider(uint256 agentId)`
- `setAgentId(uint256 agentId)`
- `registerService(ServiceInput) returns (bytes32 key)` registers a new service or reactivates an inactive one
- `updateService(ServiceInput)`
- `deactivateService(string name)`
- `subscribe(uint8 periods)` periods 1 to 12, pulls `proPricePerPeriod * periods` USDC to the treasury

Views:
- `providers(address)`, `planOf(address)` (1 Pro, 0 Free), `maxServices(address)` (Free 1, Pro 10)
- `getService(bytes32)`, `getServices(uint256 offset, uint256 limit)` (limit capped at 100), `servicesOf(address)` (keys only), `serviceCount()`
- `computeKey(address, string)`
- `usdc()`, `treasury()`, `identityRegistry()`, `proPricePerPeriod()`, `PERIOD`, `owner()`, `pendingOwner()`, `paused()`

Owner:
- `setProPrice(uint256)`, `setTreasury(address)`, `pause()`, `unpause()`
- `transferOwnership(address)` and `acceptOwnership()` (two-step)
- `renounceOwnership()` always reverts

## Events

`ProviderRegistered`, `AgentIdUpdated`, `ServiceRegistered`, `ServiceUpdated`, `ServiceDeactivated`, `Subscribed`, `ProPriceUpdated`, `TreasuryUpdated`, plus OpenZeppelin `OwnershipTransferStarted`, `OwnershipTransferred`, `Paused`, `Unpaused`.

## Behaviour notes

- Service key is `keccak256(abi.encode(provider, name))`.
- Reactivating an inactive service keeps its key and `createdAt`, does not add to `servicesOf` or `serviceCount`, and counts against the plan limit.
- When Pro expires, active services stay active. Only new registrations and reactivations are limited.
- `agentId` 0 means no identity. A service stores a snapshot of the provider's `agentId` at its last register or update.
- Prices must contain at least one digit from 1 to 9 (so "0" and "0.00" are rejected).
