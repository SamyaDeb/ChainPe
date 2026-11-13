---
id: smart-contracts-registry
title: ChainPeRegistry
sidebar_position: 2
---

# ChainPeRegistry

On-chain registry of x402-gated API services for the ChainPe marketplace on Avalanche C-Chain.

**Mainnet address (proxy):** [`0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`](https://snowtrace.io/address/0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E#code)
**Solidity:** `contracts/contracts/ChainPeRegistry.sol`
**Inherits:** `Ownable2Step`, `ReentrancyGuard`, `Pausable`

## Purpose

A mapping-based service marketplace. Providers call `register()` to list their x402-gated endpoints. Agents enumerate via `getServices()` or listen to events. The storage key is `keccak256(abi.encode(developer, name))`, making each (developer, name) pair unique.

## State variables

| Variable | Type | Description |
|---|---|---|
| `feeToken` | `IERC20` | ERC-20 used for registration fees (USDC) |
| `feeRecipient` | `address` | Treasury that receives fees |
| `registrationFee` | `uint256` | Fee per `register()`, in `feeToken` atomic units |
| `updateFee` | `uint256` | Fee per `update()`. Currently 0 (free updates). |
| `identityRegistry` | `address` | ERC-8004 IdentityRegistry address (may be `address(0)`) |
| `MAX_SERVICES_PER_PAGE` | `uint256` (constant) | `100` — max page size for `getServices()` |

## Service struct

```solidity
struct Service {
    string name;           // unique per developer; max 64 bytes
    string description;    // max 1024 bytes
    string tags;           // comma-separated; max 256 bytes
    string endpoint;       // public x402-gated URL; max 256 bytes
    string pricePerRequest; // human-readable USDC e.g. "0.01"; max 32 bytes
    string paymentToken;   // "USDC" | "AVAX"
    string network;        // "avalanche" | "fuji"
    address payTo;         // receives payments
    address developer;     // the registrant (msg.sender of register())
    uint256 agentId;       // ERC-8004 agent identity (0 = unlinked)
    uint64 createdAt;      // block.timestamp at registration
    uint64 updatedAt;      // block.timestamp at last update
    bool exists;           // used for existence checks
}
```

## ServiceInput struct

The calldata bundle for `register()` and `update()`:

```solidity
struct ServiceInput {
    string name;
    string description;
    string tags;
    string endpoint;
    string pricePerRequest;
    string paymentToken;
    string network;
    address payTo;
    uint256 agentId;
}
```

## Functions

### `register(ServiceInput input) → bytes32 key`

Registers a new service. `msg.sender` becomes the `developer`. Requires prior USDC approval of at least `registrationFee`.

**Access:** Any address (not paused)
**Modifiers:** `nonReentrant`, `whenNotPaused`
**Events emitted:** `ServiceRegistered`, `RegistrationFeePaid`
**Reverts:**
- `EmptyName()` — if `input.name` is empty
- `ZeroAddress()` — if `input.payTo == address(0)`
- `ServiceAlreadyExists(key)` — if `(developer, name)` is already registered
- `StringTooLong(field)` — if any string field exceeds its max length

### `update(ServiceInput input) → bytes32 key`

Updates an existing service. Only the original `developer` can call.

**Access:** Only the original developer
**Modifiers:** `nonReentrant`, `whenNotPaused`
**Events emitted:** `ServiceUpdated`, `RegistrationFeePaid` (if `updateFee > 0`)
**Reverts:**
- `ServiceNotFound(key)` — if the service does not exist
- `NotServiceDeveloper(caller, developer)` — if caller is not the developer
- `ZeroAddress()` — if `input.payTo == address(0)`

### `deregister(string name)`

Removes a service. No fee.

**Access:** Only the original developer
**Modifiers:** `nonReentrant`, `whenNotPaused`
**Events emitted:** `ServiceDeregistered`
**Reverts:** `ServiceNotFound`, `NotServiceDeveloper`

### `getService(address developer, string name) → Service`

Returns the full service struct. Reverts with `ServiceNotFound` if absent.

### `getServiceByKey(bytes32 key) → Service`

Like `getService` but by the pre-computed storage key.

### `hasService(address developer, string name) → bool`

Returns `true` if the service exists. No revert.

### `getServiceCount() → uint256`

Total number of registered services.

### `getServices(uint256 offset, uint256 limit) → Service[]`

Paginated list of services. `limit` is capped at 100.

**Reverts:**
- `InvalidPagination(offset, limit)` — if `offset > total`, `limit == 0`, or `limit > 100`

### `getServiceKeyAt(uint256 index) → bytes32`

Returns the storage key at a given index in the enumeration array.

### `computeKey(address developer, string name) → bytes32`

Computes the deterministic storage key: `keccak256(abi.encode(developer, name))`.

### Admin functions (owner only)

| Function | Description |
|---|---|
| `setRegistrationFee(uint256)` | Update the registration fee |
| `setUpdateFee(uint256)` | Update the update fee (may be 0) |
| `setFeeRecipient(address)` | Change the fee treasury address |
| `setFeeToken(IERC20)` | Change the fee token (takes effect immediately) |
| `setIdentityRegistry(address)` | Link to an ERC-8004 IdentityRegistry |
| `pause()` | Pause register/update/deregister |
| `unpause()` | Resume normal operation |
| `ownerWithdraw(IERC20, uint256)` | Rescue accidentally sent tokens |

## Events

```solidity
event ServiceRegistered(
    bytes32 indexed key,
    address indexed developer,
    string name,
    string endpoint,
    string pricePerRequest,
    string paymentToken,
    address payTo,
    uint256 indexed agentId
);

event ServiceUpdated(
    bytes32 indexed key,
    address indexed developer,
    string name,
    string endpoint,
    string pricePerRequest,
    string paymentToken,
    address payTo,
    uint256 indexed agentId
);

event ServiceDeregistered(bytes32 indexed key, address indexed developer, string name);

event RegistrationFeePaid(address indexed payer, address indexed feeRecipient, uint256 amount);

event FeeTokenUpdated(address indexed oldToken, address indexed newToken);
event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
event RegistrationFeeUpdated(uint256 oldFee, uint256 newFee);
event UpdateFeeUpdated(uint256 oldFee, uint256 newFee);
event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
```

## Custom errors

```solidity
error ServiceAlreadyExists(bytes32 key);
error ServiceNotFound(bytes32 key);
error NotServiceDeveloper(address caller, address developer);
error ZeroAddress();
error EmptyName();
error StringTooLong(string field);
error InvalidPagination(uint256 offset, uint256 limit);
```

## Calling from TypeScript (ethers/viem)

### Using viem

```ts
import { createPublicClient, createWalletClient, http, parseUnits, getAddress } from 'viem'
import { avalanche } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const REGISTRY = '0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E'
const USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'

// Read
const publicClient = createPublicClient({ chain: avalanche, transport: http() })

const count = await publicClient.readContract({
  address: REGISTRY,
  abi: [{ type: 'function', name: 'getServiceCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
  functionName: 'getServiceCount'
})

// Write (register)
const account = privateKeyToAccount('0xYOUR_KEY')
const walletClient = createWalletClient({ account, chain: avalanche, transport: http() })

// Step 1: Approve USDC
await walletClient.writeContract({
  account, chain: avalanche,
  address: USDC,
  abi: [{ type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }],
  functionName: 'approve',
  args: [REGISTRY, parseUnits('0.1', 6)]
})

// Step 2: Register
const txHash = await walletClient.writeContract({
  account, chain: avalanche,
  address: REGISTRY,
  abi: [/* ServiceInput tuple ABI */],
  functionName: 'register',
  args: [{
    name: 'My Service',
    description: 'Description',
    tags: 'ai,research',
    endpoint: 'https://api.example.com',
    pricePerRequest: '0.01',
    paymentToken: 'USDC',
    network: 'avalanche',
    payTo: getAddress('0xYourWallet'),
    agentId: 0n
  }]
})
```

## Solidity interface

```solidity
interface IChainPeRegistry {
    function register(ServiceInput calldata input) external returns (bytes32 key);
    function update(ServiceInput calldata input) external returns (bytes32 key);
    function deregister(string calldata name) external;
    function getService(address developer, string calldata name) external view returns (Service memory);
    function hasService(address developer, string calldata name) external view returns (bool);
    function getServiceCount() external view returns (uint256);
    function getServices(uint256 offset, uint256 limit) external view returns (Service[] memory);
    function computeKey(address developer, string memory name) external pure returns (bytes32);
    function registrationFee() external view returns (uint256);
}
```
