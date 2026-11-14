/** The parts of ChainPeRegistry (contracts/contracts/ChainPeRegistryUpgradeable.sol) this service reads. */
import { parseAbi } from 'viem'

export const registryAbi = parseAbi([
  'struct Service { string name; string description; string tags; string endpoint; string pricePerRequest; string paymentToken; string network; address payTo; address developer; uint256 agentId; uint64 createdAt; uint64 updatedAt; bool exists; }',
  'event ServiceRegistered(bytes32 indexed key, address indexed developer, string name, string endpoint, string pricePerRequest, string paymentToken, address payTo, uint256 indexed agentId)',
  'event ServiceUpdated(bytes32 indexed key, address indexed developer, string name, string endpoint, string pricePerRequest, string paymentToken, address payTo, uint256 indexed agentId)',
  'event ServiceDeregistered(bytes32 indexed key, address indexed developer, string name)',
  'function getServiceByKey(bytes32 key) view returns (Service)',
  'function getServiceCount() view returns (uint256)',
  'function getServices(uint256 offset, uint256 limit) view returns (Service[])',
])

export const MAX_SERVICES_PER_PAGE = 100n
