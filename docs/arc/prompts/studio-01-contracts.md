You are building the on-chain part of ChainPe on Arc. ChainPe lets developers sell API calls to AI agents
over x402; payments settle through Circle. This contract holds provider accounts, their services, and a
paid Pro plan. The full spec is in context/docs/arc/specs/06-provider-accounts.md — follow it exactly.
Reference only (do not copy upgradeability): context/contracts/contracts/ChainPeRegistryUpgradeable.sol
and context/contracts/contracts/PolicyVaultUpgradeable.sol.

Task 1 — write contracts/ChainPeAccounts.sol
- Solidity ^0.8.24, OpenZeppelin v5: Ownable2Step, Pausable, ReentrancyGuard, SafeERC20. Not upgradeable.
- constructor(IERC20 usdc, address treasury, address identityRegistry, uint256 proPricePerPeriod). PERIOD = 30 days.
- Provider struct, Service struct, storage, functions, views and events exactly as in the spec:
  registerProvider(agentId), setAgentId, registerService(ServiceInput), updateService, deactivateService(name),
  subscribe(uint8 periods) pulling USDC to treasury, planOf(address) (1 = Pro if paidUntil > now, else 0),
  maxServices (Free 1, Pro 10), getService(key), servicesOf(provider), getServices(offset, limit), serviceCount,
  setProPrice, setTreasury, pause, unpause.
- Service key = keccak256(abi.encode(provider, name)). Validate string lengths (name 1-64, endpoint 1-256,
  price 1-32, description <= 1024, tags <= 256). payTo and treasury must not be address(0) (Arc reverts
  sends to the zero address).
- If agentId != 0, require IERC721(identityRegistry).ownerOf(agentId) == msg.sender.
- Use custom errors, not revert strings. NatSpec on every external function.

Task 2 — Foundry tests in test/ChainPeAccounts.t.sol
Use a mock 6-decimal ERC-20 for USDC and a minimal mock ERC-721 for the identity registry. Cover:
register provider; duplicate provider reverts; agentId owned by someone else reverts; free plan second
service reverts; subscribe pulls exact amount to treasury and sets paidUntil; subscribe twice stacks;
planOf returns 0 after expiry (vm.warp); Pro allows 10 services, 11th reverts; update/deactivate only by
the service owner; pause blocks writes; getServices pagination; setTreasury(0) reverts.
Run the tests and fix until green.

Task 3 — deploy to Arc testnet
Constructor args:
- usdc = 0x3600000000000000000000000000000000000000
- treasury = the deployer address
- identityRegistry = 0x8004A818BFB912233c491871b3d84c89A494BD9e (Arc testnet ERC-8004 IdentityRegistry)
- proPricePerPeriod = 19000000 (19 USDC, 6 decimals)
After deploy, call registerProvider(0) once from the deployer as a smoke test.

Task 4 (optional, only if Tasks 1-3 are done) — contracts/PolicyVault.sol
Port the logic of the reference PolicyVaultUpgradeable as a non-upgradeable contract for Arc USDC
(deposit, withdraw, setPolicy, setAllowlist, revokeSession, EIP-712 spend with session key, previewSpend,
daily cap, total budget, expiry, allowlist). Foundry tests for every cap. Deploy to Arc testnet.

Output when finished:
- deployed addresses with explorer links and tx hashes
- the ABI of ChainPeAccounts at abi/ChainPeAccounts.json
- a short README at contracts/README.md listing functions, events and the deployment
Do not create a frontend in this run.
