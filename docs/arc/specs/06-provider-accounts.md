# Spec 06 — Provider accounts, plans, `ChainPeAccounts` contract

**Goal:** registration on Arc creates a provider account (the key to the personalised dashboard) and
lists services; a Pro plan is paid in USDC on-chain. **Built, tested and deployed in Arc Studio**
(prompt: `../prompts/studio-01-contracts.md`).

## Contract: `ChainPeAccounts.sol`

Solidity ^0.8.24, OpenZeppelin v5 (`Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`).
Non-upgradeable for the hackathon (simpler to audit). Network: Arc testnet first, mainnet later with our own key.

### Constructor

```solidity
constructor(IERC20 usdc, address treasury, address identityRegistry, uint256 proPricePerPeriod, address initialOwner)
// All five are required: zero values revert. Studio's deployer is never the owner.
// usdc = 0x3600000000000000000000000000000000000000 (ERC-20 interface, 6 decimals)
// identityRegistry = Arc ERC-8004 IdentityRegistry (testnet 0x8004A818…BD9e, mainnet 0x8004A169…a432)
// proPricePerPeriod = testnet 1_000_000 (1 USDC), mainnet 19_000_000 (19 USDC); PERIOD = 30 days
// initialOwner = treasury = testnet 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
// Public getters: usdc(), treasury(), identityRegistry(), proPricePerPeriod(), PERIOD, owner()
```

### Storage

```solidity
struct Provider { bool exists; uint256 agentId; uint64 createdAt; uint64 paidUntil; uint32 activeServices; }
struct Service {
  bytes32 key; address provider; address payTo; uint256 agentId;
  string name; string description; string tags; string endpoint;
  string pricePerRequest;   // human USDC, e.g. "0.01"
  string network;           // "eip155:5042" | "eip155:5042002"; 1-32 bytes
  bool acceptsExact; bool acceptsGateway; bool active;
  uint64 createdAt; uint64 updatedAt;
}
mapping(address => Provider) public providers;
mapping(bytes32 => Service) internal services;     // key = keccak256(abi.encode(provider, name))
mapping(address => bytes32[]) internal servicesByProvider;
bytes32[] internal allKeys;
```

`ServiceInput` = `name, description, tags, endpoint, pricePerRequest, network, payTo, acceptsExact, acceptsGateway`.
It has no `active` field, so `updateService` cannot change whether a service is active.

### Functions

| Function | Rules |
|---|---|
| `registerProvider(uint256 agentId)` | once per address; if `agentId != 0` require `IERC721(identityRegistry).ownerOf(agentId) == msg.sender`; free |
| `setAgentId(uint256 agentId)` | provider must exist; same ownership check; `0` clears it; emits `AgentIdUpdated` |
| `registerService(ServiceInput)` | provider must exist; name 1-64 bytes, endpoint 1-256, price 1-32, network 1-32, description ≤ 1024, tags ≤ 256; `payTo != 0` and `payTo == msg.sender`; `pricePerRequest` has a digit 1-9 (rejects `"0"` and `"0.00"`; not a format check); at least one rail; `activeServices < maxServices(msg.sender)`. An active key reverts. An inactive key is **reactivated** (see below) |
| `updateService(ServiceInput)` | key derived from `msg.sender` + `name`, so only its owner can reach it; service must exist and be active; same validation; `createdAt` unchanged; never changes `activeServices` |
| `deactivateService(string name)` | only owner; must be active; `active = false`, `activeServices -= 1`; keeps history |
| `subscribe(uint8 periods)` | provider must exist; `1 ≤ periods ≤ 12`; `nonReentrant`; set `paidUntil = max(now, paidUntil) + periods * 30 days` (`uint64`, via `SafeCast`), then pull `proPricePerPeriod * periods` USDC to `treasury` via `safeTransferFrom` |
| `planOf(address) view` | `1` (Pro) if `paidUntil > block.timestamp`, else `0` (Free) |
| `maxServices(address) view` | Free 1, Pro 10 |
| `getService(bytes32)`, `getServices(uint256 offset, uint256 limit)`, `serviceCount()` | full `Service` structs. `limit` is capped at 100; an `offset` past the end returns an empty array |
| `servicesOf(address)` | keys only, including inactive services |
| `setProPrice`, `setTreasury`, `pause`, `unpause` | `onlyOwner`; price ≠ 0; treasury ≠ 0 (Arc reverts sends to address(0)) |
| `renounceOwnership` | always reverts, so the contract cannot lose its owner |

### Rules that decide edge cases

- **Reactivation.** `registerService` on an inactive key keeps the same key and `createdAt`, overwrites the other
  fields, sets `active = true`, adds 1 to `activeServices`, and counts against `maxServices`. It does not push to
  `allKeys` or `servicesByProvider`, so there are no duplicate keys and no orphaned entries. It emits `ServiceRegistered`.
- **Downgrade after Pro expires.** Existing active services stay active. Only new registrations and reactivations
  are limited: a provider with `activeServices >= 1` on Free cannot add another until it deactivates enough.
  We chose this so a lapsed plan never takes a live API offline.
- **Pause.** Blocks `registerProvider`, `setAgentId`, `registerService`, `updateService`, `deactivateService` and
  `subscribe`. Views and owner functions still work.
- **`agentId`.** `0` means "no identity". Token 0 does exist on the Arc testnet registry, so its owner cannot link it.
  `Service.agentId` is a snapshot from the last register or update. `providers(addr).agentId` is the current value.
  The contract does not track later transfers of the ERC-8004 token, so read `ownerOf` when ownership matters.

- **`payTo`.** Must be the caller, in both `registerService` and `updateService`. Spec 08 treats `payTo` as proof of
  ownership when it attributes revenue, and Circle only settles to a `payTo` the seller key controls, so no valid flow
  needs another address. Review finding M-1 (`../reviews/chainpe-accounts-review.md`).

### Events

`ProviderRegistered(address indexed provider, uint256 indexed agentId)` ·
`AgentIdUpdated(address indexed provider, uint256 indexed agentId)` ·
`ServiceRegistered(bytes32 indexed key, address indexed provider, string name, string endpoint, string pricePerRequest, address payTo, string network, bool acceptsExact, bool acceptsGateway, uint256 agentId)` ·
`ServiceUpdated(...)` same fields · `ServiceDeactivated(bytes32 indexed key, address indexed provider)` ·
`Subscribed(address indexed provider, uint8 periods, uint256 amount, uint64 paidUntil)` ·
`ProPriceUpdated(uint256 oldPrice, uint256 newPrice)` · `TreasuryUpdated(address oldT, address newT)`

`network`, the rails and `agentId` are in the events because the spec 08 `providers` and `services` tables store them.

### Foundry tests (in Studio)

register provider · duplicate provider reverts · agentId owned by someone else reverts · free plan 2nd service reverts ·
subscribe pulls exact USDC (mock 6-dec ERC-20) and extends `paidUntil` · subscribe twice stacks · planOf flips after expiry (`vm.warp`) ·
update/deactivate only by owner · pause blocks writes · views paginate · deactivate then re-register reactivates the
same key with no duplicate, and counts against the limit · expired Pro keeps its services but cannot add one ·
zero constructor args revert · `renounceOwnership` reverts.

## Verified facts (2026-11-06)

- **Identity registry.** Arc testnet `0x8004A818…BD9e` is an ERC-1967 proxy to the verified
  `IdentityRegistryUpgradeable` (`0x7274e874…9c02`). `supportsInterface(0x80ac58cd)` is true (ERC-721) and
  `ownerOf(uint256)` returns owners for tokens 0, 1 and 2, so the `ownerOf` check stands as written.
- **Pro price on testnet.** The Circle faucet gives 20 USDC per address every 2 hours, and gas is also USDC, so a
  19 USDC subscribe nearly empties a wallet. Testnet uses **1 USDC**; mainnet stays **19 USDC**.
- **Deployer.** The Studio CLI guide does not say which wallet deploys, so ownership is set explicitly with
  `initialOwner` and checked on-chain after deploy.

## CLI (`chainpe register` on `arc*`)

The command reads first and sends only what is missing, so a failed run resumes and a run with nothing to do sends no transaction.

1. Ensure ERC-8004 identity (spec 10) → `agentId`.
2. No provider: `registerProvider(agentId)`. Provider with another `agentId`: `setAgentId(agentId)`.
3. Service absent or inactive: `registerService` (needs a free slot). Active and different, including a stale `agentId` snapshot: `updateService`. Active and identical: nothing.
4. Print key, tx hashes, explorer links, and the dashboard URL if `CHAINPE_DASHBOARD_URL` is set.

`endpoint` is the config's `publicUrl`, never `targetUrl`: publishing the backend would let buyers skip payment, permanently.
`publicUrl` must be https (`--allow-http` on testnet only), not a private host, and not the backend's origin. Hostnames are checked as
written, so a public name that resolves to a private address is not caught. `acceptsExact` follows the same rule as the 402: only at $0.01 or more.

`chainpe plan` prints plan + `paidUntil`. `chainpe upgrade --periods 1` asks to confirm (`--yes` skips), approves exactly `price * periods`, subscribes, and checks `paidUntil` moved (key local).
`chainpe list` shows active services (`--all`, `--mine`, `--json`), reads 25 per page, and strips control characters: on-chain strings are untrusted.

## Acceptance

- [x] Studio run 1 deploys to Arc testnet; address + traceId logged in `STUDIO-LOG.md`.
- [x] All Foundry tests pass in Studio.
- [x] `chainpe register --network arc-testnet` creates provider + service; `chainpe list` shows it.
- [ ] `chainpe upgrade` → `planOf == 1` → dashboard shows Pro.
