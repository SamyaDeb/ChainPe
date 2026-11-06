You are building the on-chain part of ChainPe on Arc. ChainPe lets developers sell API calls to AI agents
over x402; payments settle through Circle. This contract holds provider accounts, their services, and a
paid Pro plan. The full spec is in context/docs/arc/specs/06-provider-accounts.md — follow it exactly.
Reference only (do not copy upgradeability): context/contracts/contracts/ChainPeRegistryUpgradeable.sol.

Task 1 — write contracts/ChainPeAccounts.sol
- Solidity ^0.8.24, OpenZeppelin v5: Ownable2Step, Pausable, ReentrancyGuard, SafeERC20. Not upgradeable.
- constructor(IERC20 usdc, address treasury, address identityRegistry, uint256 proPricePerPeriod, address initialOwner).
  All five non-zero or revert. PERIOD = 30 days. Public getters: usdc(), treasury(), identityRegistry(),
  proPricePerPeriod(), PERIOD, owner().
- Provider struct, Service struct, ServiceInput, storage, functions, views and events exactly as in the spec:
  registerProvider(agentId), setAgentId, registerService(ServiceInput), updateService, deactivateService(name),
  subscribe(uint8 periods) pulling USDC to treasury, planOf(address) (1 = Pro if paidUntil > now, else 0),
  maxServices (Free 1, Pro 10), getService(key), servicesOf(provider), getServices(offset, limit), serviceCount,
  setProPrice, setTreasury, pause, unpause. Include every event field in the spec, and AgentIdUpdated.
- Service key = keccak256(abi.encode(provider, name)). Validate string lengths (name 1-64, endpoint 1-256,
  price 1-32, network 1-32, description <= 1024, tags <= 256). At least one rail must be true. payTo, treasury and
  every constructor address must not be address(0) (Arc reverts sends to the zero address). Price must not be 0.
- If agentId != 0, require IERC721(identityRegistry).ownerOf(agentId) == msg.sender. setAgentId(0) clears it.
- deactivateService requires an active service and decrements activeServices. registerService on an inactive key
  reactivates that same key: keep key and createdAt, overwrite the other fields, set active, increment
  activeServices, count against maxServices, do not push to allKeys or servicesByProvider, emit ServiceRegistered.
  registerService on an active key reverts.
- updateService requires an active service, never changes active or activeServices, keeps createdAt.
- After Pro expires, existing active services stay active. Only new registrations and reactivations are limited.
- subscribe requires an existing provider and periods 1..12, is nonReentrant, sets
  paidUntil = max(now, paidUntil) + periods * 30 days as uint64 using SafeCast, then calls
  safeTransferFrom(msg.sender, treasury, proPricePerPeriod * periods).
- whenNotPaused on registerProvider, setAgentId, registerService, updateService, deactivateService, subscribe.
  Views and owner functions work while paused.
- getServices caps limit at 100 and returns an empty array when offset is past the end. servicesOf returns keys only.
- Override renounceOwnership to always revert.
- Use custom errors, not revert strings. NatSpec on every external function.

Task 2 — Foundry tests in test/ChainPeAccounts.t.sol
Use a mock 6-decimal ERC-20 for USDC and a minimal mock ERC-721 for the identity registry. Cover:
register provider; duplicate provider reverts; agentId owned by someone else reverts; free plan second
service reverts; subscribe pulls exact amount to treasury and sets paidUntil; subscribe twice stacks;
subscribe without a provider reverts; periods 0 and 13 revert; planOf returns 0 after expiry (vm.warp); Pro allows
10 services, 11th reverts; expired Pro keeps its services but cannot add one; deactivate then re-register reactivates
the same key with no duplicate in servicesOf or serviceCount and counts against the limit; update of an inactive
service reverts; update/deactivate only by the service owner; pause blocks every write listed above and views still
work; getServices pagination and the 100 cap; setTreasury(0) and setProPrice(0) revert; each zero constructor
argument reverts; renounceOwnership reverts; owner functions use two-step transfer.
Run the tests and fix until green.

Task 3 — deploy to Arc testnet
Constructor args:
- usdc = 0x3600000000000000000000000000000000000000
- treasury = 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
- identityRegistry = 0x8004A818BFB912233c491871b3d84c89A494BD9e (Arc testnet ERC-8004 IdentityRegistry)
- proPricePerPeriod = 1000000 (1 USDC on testnet, 6 decimals)
- initialOwner = 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
Do not call any function after deploy; the smoke test runs from other wallets. Report which address deployed.

Do not build PolicyVault in this run. It is planned for later.

Output when finished:
- deployed address with explorer link and tx hash, the deployer address, and the exact solc version, optimizer
  settings and OpenZeppelin version used
- the ABI of ChainPeAccounts at abi/ChainPeAccounts.json
- a short README at contracts/README.md listing functions, events and the deployment
Do not create a frontend in this run.
