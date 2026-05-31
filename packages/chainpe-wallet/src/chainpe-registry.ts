/**
 * ChainPe Registry Reader (self-contained)
 *
 * Reads service registrations from the on-chain ChainPeRegistry contract on
 * Algorand. Ported from packages/chainpe-agent/src/registry.ts and trimmed to a
 * single dependency (algosdk) so it can be bundled into the .mcpb wallet.
 *
 * App ID priority:
 *   1. CHAINPE_REGISTRY_APP_ID environment variable
 *   2. Default fallback (757478481 — deployed registry)
 */

import algosdk from 'algosdk'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_APP_ID = 757478481n
const ARC4_RETURN_PREFIX = new Uint8Array([0x15, 0x1f, 0x7c, 0x75])

export const ALGOD_TESTNET_URL = 'https://testnet-api.algonode.cloud'
export const ALGOD_MAINNET_URL = 'https://mainnet-api.algonode.cloud'
export const INDEXER_TESTNET_URL = 'https://testnet-idx.algonode.cloud'
export const INDEXER_MAINNET_URL = 'https://mainnet-idx.algonode.cloud'

export type ChainPeNetwork = 'testnet' | 'mainnet'
export type RegistryPaymentToken = 'ALGO' | 'USDC'

export interface ChainPeService {
  id: string
  name: string
  description: string
  tags: string[]
  endpoint: string
  pricePerRequest: string
  paymentToken: RegistryPaymentToken
  walletAddress: string
  network: ChainPeNetwork
  createdAt?: string
  updatedAt?: string
}

export interface SearchOptions {
  name?: string
  tags?: string[]
  paymentToken?: RegistryPaymentToken
  network?: ChainPeNetwork
  maxPrice?: string
}

/**
 * Resolves the registry App ID from CHAINPE_REGISTRY_APP_ID, falling back to the
 * deployed default.
 */
function getRegistryAppId(): bigint {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID
  if (envId) {
    try {
      return BigInt(envId)
    } catch {
      // fall through to default on malformed env value
    }
  }
  return DEFAULT_APP_ID
}

// ============================================================================
// ARC-4 helpers (self-contained, no shared dep)
// ============================================================================

function methodSelector(signature: string): Uint8Array {
  return algosdk.ABIMethod.fromSignature(signature).getSelector()
}

function encodeArc4String(s: string): Uint8Array {
  const utf8 = new TextEncoder().encode(s)
  const buf = new Uint8Array(2 + utf8.length)
  new DataView(buf.buffer).setUint16(0, utf8.length, false)
  buf.set(utf8, 2)
  return buf
}

/**
 * Builds appArgs for getService(address, string).
 * PuyaTs-compiled contracts use separate ApplicationArgs per parameter:
 *   ApplicationArgs[0] = 4-byte method selector
 *   ApplicationArgs[1] = 32-byte raw address (static ARC-4 — no length prefix)
 *   ApplicationArgs[2] = ARC-4 string (uint16 length + bytes)
 */
function buildGetServiceArgs(
  selector: Uint8Array,
  developerAddress: string,
  serviceName: string
): Uint8Array[] {
  const addrBytes = algosdk.decodeAddress(developerAddress).publicKey
  const encodedName = encodeArc4String(serviceName)
  return [selector, addrBytes, encodedName]
}

function buildBoxKey(developerAddr: string, serviceName: string): Uint8Array {
  const prefix = new TextEncoder().encode('svc:')
  const senderBytes = algosdk.decodeAddress(developerAddr).publicKey
  const colon = new TextEncoder().encode(':')
  const nameBytes = new TextEncoder().encode(serviceName)
  const key = new Uint8Array(
    prefix.length + senderBytes.length + colon.length + nameBytes.length
  )
  let pos = 0
  key.set(prefix, pos)
  pos += prefix.length
  key.set(senderBytes, pos)
  pos += senderBytes.length
  key.set(colon, pos)
  pos += colon.length
  key.set(nameBytes, pos)
  return key
}

/**
 * Decodes ARC-4 return of getService:
 *   (string×8, address, uint64, uint64)
 * Head: 8×uint16 offsets (16B) + address inline (32B) + 2×uint64 (16B) = 64B
 */
function decodeServiceData(data: Uint8Array): ChainPeService {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false))
  const developer = algosdk.encodeAddress(data.slice(16, 48))
  const createdAt = Number(view.getBigUint64(48, false))
  const updatedAt = Number(view.getBigUint64(56, false))

  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false)
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len))
  })

  const [
    name,
    description,
    tagsStr,
    endpoint,
    pricePerRequest,
    paymentToken,
    walletAddress,
    network
  ] = strings

  return {
    id: `${developer}:${name}`,
    name,
    description,
    tags: tagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken: paymentToken as RegistryPaymentToken,
    walletAddress,
    network: network as ChainPeNetwork,
    createdAt: createdAt ? new Date(createdAt * 1000).toISOString() : undefined,
    updatedAt: updatedAt ? new Date(updatedAt * 1000).toISOString() : undefined
  }
}

// ============================================================================
// On-chain fetch
// ============================================================================

async function fetchServiceOnChain(
  algod: algosdk.Algodv2,
  appId: bigint,
  developerAddress: string,
  serviceName: string
): Promise<ChainPeService | null> {
  try {
    const sig =
      'getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)'
    const selector = methodSelector(sig)
    const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName)
    const boxKey = buildBoxKey(developerAddress, serviceName)
    const sp = await algod.getTransactionParams().do()

    const tx = algosdk.makeApplicationNoOpTxnFromObject({
      sender: developerAddress,
      appIndex: appId,
      appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: sp
    })

    const encodedTxn = algosdk.encodeUnsignedSimulateTransaction(tx)
    const signedTxn = algosdk.decodeSignedTransaction(encodedTxn)

    const request = new algosdk.modelsv2.SimulateRequest({
      txnGroups: [
        new algosdk.modelsv2.SimulateRequestTransactionGroup({ txns: [signedTxn] })
      ],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      allowMoreLogging: true
    })

    const result = await algod.simulateTransactions(request).do()
    const logs = result.txnGroups?.[0]?.txnResults?.[0]?.txnResult?.logs ?? []

    for (const log of logs) {
      if (
        log.length > 4 &&
        log[0] === ARC4_RETURN_PREFIX[0] &&
        log[1] === ARC4_RETURN_PREFIX[1] &&
        log[2] === ARC4_RETURN_PREFIX[2] &&
        log[3] === ARC4_RETURN_PREFIX[3]
      ) {
        return decodeServiceData(log.slice(4))
      }
    }
    return null
  } catch {
    return null
  }
}

// ============================================================================
// Filtering
// ============================================================================

export function filterServices(
  services: ChainPeService[],
  options: SearchOptions
): ChainPeService[] {
  let results = [...services]
  if (options.name) {
    const nl = options.name.toLowerCase()
    results = results.filter(
      (s) =>
        s.name.toLowerCase().includes(nl) ||
        s.description.toLowerCase().includes(nl) ||
        s.tags.some((tag) => tag.toLowerCase().includes(nl))
    )
  }
  if (options.tags?.length) {
    const tl = options.tags.map((t) => t.toLowerCase())
    results = results.filter((s) =>
      s.tags.some((tag) => tl.includes(tag.toLowerCase()))
    )
  }
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken)
  }
  if (options.network) {
    results = results.filter((s) => s.network === options.network)
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice)
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max)
  }
  return results
}

// ============================================================================
// RegistryClient — on-chain reads
// ============================================================================

export class RegistryClient {
  private algod: algosdk.Algodv2
  private appId: bigint
  private network: ChainPeNetwork
  private indexerUrl: string

  constructor(network: ChainPeNetwork = 'testnet') {
    this.network = network
    const algodUrl = network === 'testnet' ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL
    this.indexerUrl =
      network === 'testnet' ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL

    this.algod = new algosdk.Algodv2('', algodUrl, '')
    this.appId = getRegistryAppId()
  }

  /** App ID of the registry contract. */
  getAppId(): bigint {
    return this.appId
  }

  /** Fetches a specific service by developer address and name. */
  async findService(
    developerAddress: string,
    name: string
  ): Promise<ChainPeService | undefined> {
    const svc = await fetchServiceOnChain(
      this.algod,
      this.appId,
      developerAddress,
      name
    )
    return svc ?? undefined
  }

  /**
   * Lists ALL services registered on-chain by enumerating the registry
   * contract's boxes via the Algorand Indexer, then reading each one.
   *
   * Box key format (binary): "svc:" + <32-byte pubkey> + ":" + <service_name>
   */
  async listAllServices(): Promise<ChainPeService[]> {
    const boxesUrl = `${this.indexerUrl}/v2/applications/${this.appId}/boxes`
    const response = await fetch(boxesUrl)
    if (!response.ok) {
      throw new Error(
        `Indexer API error: ${response.status} ${response.statusText}`
      )
    }

    const data = (await response.json()) as { boxes?: Array<{ name: string }> }
    const boxes = data.boxes ?? []

    const servicePromises: Promise<ChainPeService | null>[] = []

    for (const box of boxes) {
      try {
        const boxKeyBytes = Buffer.from(box.name, 'base64')

        // Must start with "svc:" (4 bytes)
        if (boxKeyBytes.slice(0, 4).toString('utf-8') !== 'svc:') continue
        // Minimum: "svc:" + 32-byte pubkey + ":"
        if (boxKeyBytes.length < 4 + 32 + 1) continue

        const pubkeyBytes = boxKeyBytes.slice(4, 36)
        if (pubkeyBytes.length !== 32) continue
        // ":" separator after pubkey (byte 36, 0x3a)
        if (boxKeyBytes[36] !== 0x3a) continue

        const serviceName = boxKeyBytes.slice(37).toString('utf-8')
        if (!serviceName) continue

        const developerAddress = algosdk.encodeAddress(pubkeyBytes)
        servicePromises.push(
          fetchServiceOnChain(
            this.algod,
            this.appId,
            developerAddress,
            serviceName
          )
        )
      } catch {
        // Skip invalid box keys
        continue
      }
    }

    const services = await Promise.all(servicePromises)
    return services.filter((s): s is ChainPeService => s !== null)
  }

  /** Lists all services then applies search filters. */
  async search(options: SearchOptions = {}): Promise<ChainPeService[]> {
    const all = await this.listAllServices()
    return filterServices(all, { ...options, network: options.network ?? this.network })
  }
}
