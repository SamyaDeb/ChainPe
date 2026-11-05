# Spec 06 — Provider accounts, plans, `ChainPeAccounts` contract

**Goal:** registration on Arc creates a provider account (the key to the personalised dashboard) and
lists services; a Pro plan is paid in USDC on-chain. **Built, tested and deployed in Arc Studio**
(prompt: `../prompts/studio-01-contracts.md`).

## Contract: `ChainPeAccounts.sol`

Solidity ^0.8.24, OpenZeppelin v5 (`Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`).
Non-upgradeable for the hackathon (simpler to audit). Network: Arc testnet first, mainnet later with our own key.

### Constructor

```solidity
constructor(IERC20 usdc, address treasury, address identityRegistry, uint256 proPricePerPeriod)
// usdc = 0x3600000000000000000000000000000000000000 (ERC-20 interface, 6 decimals)
// identityRegistry = Arc ERC-8004 IdentityRegistry (testnet 0x8004A818…BD9e, mainnet 0x8004A169…a432)
// proPricePerPeriod = 19_000_000 (19 USDC), PERIOD = 30 days
```

### Storage

```solidity
struct Provider { bool exists; uint256 agentId; uint64 createdAt; uint64 paidUntil; uint32 activeServices; }
struct Service {
  bytes32 key; address provider; address payTo; uint256 agentId;
  string name; string description; string tags; string endpoint;
  string pricePerRequest;   // human USDC, e.g. "0.01"
  string network;           // "eip155:5042" | "eip155:5042002"
  bool acceptsExact; bool acceptsGateway; bool active;
  uint64 createdAt; uint64 updatedAt;
}
mapping(address => Provider) public providers;
mapping(bytes32 => Service) internal services;     // key = keccak256(abi.encode(provider, name))
mapping(address => bytes32[]) internal servicesByProvider;
bytes32[] internal allKeys;
```

### Functions

| Function | Rules |
|---|---|
| `registerProvider(uint256 agentId)` | once per address; if `agentId != 0` require `IERC721(identityRegistry).ownerOf(agentId) == msg.sender`; free |
| `setAgentId(uint256 agentId)` | same ownership check |
| `registerService(ServiceInput)` | provider must exist; name 1–64 bytes, endpoint 1–256, price 1–32; `payTo != 0`; `activeServices < maxServices(msg.sender)`; key unique |
| `updateService(ServiceInput)` | only owner of the key |
| `deactivateService(string name)` | only owner; keeps history |
| `subscribe(uint8 periods)` | `1 ≤ periods ≤ 12`; pulls `proPricePerPeriod * periods` USDC to `treasury` via `safeTransferFrom`; `paidUntil = max(now, paidUntil) + periods * 30 days` |
| `planOf(address) view` | `1` (Pro) if `paidUntil > block.timestamp`, else `0` (Free) |
| `maxServices(address) view` | Free 1, Pro 10 |
| `getService(bytes32)`, `servicesOf(address)`, `getServices(uint256 offset, uint256 limit)`, `serviceCount()` | views for CLI, cloud, dashboard |
| `setProPrice`, `setTreasury`, `pause`, `unpause` | `onlyOwner`; treasury ≠ 0 (Arc reverts sends to address(0)) |

### Events

`ProviderRegistered(address indexed provider, uint256 indexed agentId)` ·
`ServiceRegistered(bytes32 indexed key, address indexed provider, string name, string endpoint, string pricePerRequest, address payTo)` ·
`ServiceUpdated(...)` same fields · `ServiceDeactivated(bytes32 indexed key, address indexed provider)` ·
`Subscribed(address indexed provider, uint8 periods, uint256 amount, uint64 paidUntil)` ·
`ProPriceUpdated(uint256 oldPrice, uint256 newPrice)` · `TreasuryUpdated(address oldT, address newT)`

### Foundry tests (in Studio)

register provider · duplicate provider reverts · agentId owned by someone else reverts · free plan 2nd service reverts ·
subscribe pulls exact USDC (mock 6-dec ERC-20) and extends `paidUntil` · subscribe twice stacks · planOf flips after expiry (`vm.warp`) ·
update/deactivate only by owner · pause blocks writes · views paginate.

## CLI (`chainpe register` on `arc*`)

1. Ensure ERC-8004 identity (spec 10) → `agentId`.
2. `registerProvider(agentId)` if `providers(addr).exists == false`.
3. `registerService` from config; network = CAIP-2; rails from config.
4. Print key, tx hashes, explorer links, and the dashboard URL.
`chainpe plan` prints plan + `paidUntil`; `chainpe upgrade --periods 1` does `approve` + `subscribe` (key local).

## Acceptance

- [ ] Studio run 1 deploys to Arc testnet; address + traceId logged in `STUDIO-LOG.md`.
- [ ] All Foundry tests pass in Studio.
- [ ] `chainpe register --network arc-testnet` creates provider + service; `chainpe list` shows it.
- [ ] `chainpe upgrade` → `planOf == 1` → dashboard shows Pro.
