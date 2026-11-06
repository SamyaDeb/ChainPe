Add a new contract to this app: ChainPeFees, which collects a usage fee from providers who approve it. Do not change or redeploy ChainPeAccounts. Do not touch src/ or the dashboard. The rules are in context/docs/arc/specs/12-usage-fees.md: follow it exactly. Balanced preset.

Write contracts/ChainPeFees.sol:
- Solidity ^0.8.24, OpenZeppelin v5: Ownable2Step, Pausable, ReentrancyGuard, SafeERC20. Not upgradeable. Custom errors. Same style as ChainPeAccounts.
- constructor(IERC20 usdc, address treasury, address collector, address initialOwner). All non-zero or revert.
- uint16 public constant MAX_FEE_BPS = 500. Public getters: usdc(), treasury(), collector(), owner().
- mapping(bytes32 => bool) public batchCollected.
- collect(address provider, uint256 revenueAtomic, uint256 feeAtomic, bytes32 batchId): onlyCollector, nonReentrant, whenNotPaused. Revert on a zero provider, a zero batchId, a zero fee, a batchId already collected, or feeAtomic * 10000 > revenueAtomic * MAX_FEE_BPS. Set batchCollected first, emit FeeCollected(bytes32 indexed batchId, address indexed provider, uint256 revenueAtomic, uint256 feeAtomic), then usdc.safeTransferFrom(provider, treasury, feeAtomic). The contract never holds funds.
- setTreasury and setCollector: onlyOwner, non-zero, emit an event with the old and new values. pause and unpause: onlyOwner. renounceOwnership reverts, as in ChainPeAccounts.

Write Foundry tests in contracts/test/ChainPeFees.t.sol: happy path moves the fee to the treasury and leaves nothing in the contract, only the collector can collect, a repeated batchId reverts, a fee of exactly 5% passes and one atomic unit above reverts, zero fee and zero batchId revert, no allowance reverts and leaves batchCollected false, a revoked allowance reverts, pause blocks collect, setTreasury and setCollector are owner-only and reject zero, renounceOwnership reverts, plus a fuzz test that the treasury gain always equals feeAtomic. Use a mock USDC with 6 decimals in tests.

Deploy to Arc testnet with these exact constructor arguments:
- usdc 0x3600000000000000000000000000000000000000
- treasury 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
- collector COLLECTOR_ADDRESS
- initialOwner 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a

Verify the source on the explorer if Studio supports it. Write the ABI to abi/ChainPeFees.json. Report the address, deploy tx, test count, and every file you changed.
