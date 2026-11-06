# ChainPe — Deployed Contracts

## Avalanche C-Chain (mainnet, chainId 43114)

Deployed 2026-06-17. Deployer / owner: `0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a`.

| Contract | Address | Proxy? | Explorer |
|---|---|---|---|
| **ChainPeRegistry** (proxy) | `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` | UUPS | [Snowtrace ✓verified](https://snowtrace.io/address/0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E#code) |
| ChainPeRegistry (impl) | `0xd3A9136F8D7F0DcEb2F97f70A7164743466D5E62` | — | [Snowtrace](https://snowtrace.io/address/0xd3A9136F8D7F0DcEb2F97f70A7164743466D5E62) |
| PolicyVault (proxy) | `0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8` | UUPS | [Snowtrace](https://snowtrace.io/address/0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8) |
| PolicyVault (impl) | `0x4cED17f828375C6852B3651b214bE0F0171f4391` | — | [Snowtrace](https://snowtrace.io/address/0x4cED17f828375C6852B3651b214bE0F0171f4391) |
| ERC-8004 IdentityRegistry (proxy) | `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195` | UUPS | [Snowtrace](https://snowtrace.io/address/0xB1330d7B1b083ba689C7f56bDf667F1F528a3195) |
| ERC-8004 ReputationRegistry (proxy) | `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543` | UUPS | [Snowtrace](https://snowtrace.io/address/0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543) |
| ERC-8004 ValidationRegistry (proxy) | `0x91477bD9211448a85eFb16ea858432a85d89b833` | UUPS | [Snowtrace](https://snowtrace.io/address/0x91477bD9211448a85eFb16ea858432a85d89b833) |
| ChainPeICMReceiver | `0xc8aBD919F597C46dA889e76704F69A2809cd6D33` | no | [Snowtrace](https://snowtrace.io/address/0xc8aBD919F597C46dA889e76704F69A2809cd6D33) |
| ChainPeICMSender | `0x097D7D4B46CB894142a72E91c3b8F8b5834255dF` | no | [Snowtrace](https://snowtrace.io/address/0x097D7D4B46CB894142a72E91c3b8F8b5834255dF) |

**ChainPeRegistry config:**
- Fee token: USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (Circle, bridged USDC on Avalanche C-Chain)
- Registration fee: `0.1 USDC` (100000 atomic) — settable by owner via `setRegistrationFee`
- Identity registry linked: yes (the ERC-8004 IdentityRegistry above)
- Teleporter (ICM): `0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf` (canonical on all Avalanche L1s)
- ChainId: 43114

The ERC-8004 registries are the official reference contracts deployed behind ERC-1967 (UUPS) proxies.

> **Note:** Legacy Fuji (testnet) contracts are retained in `contracts/deployments/fuji*.json` for reference.

## Client configuration

Point clients at the registry:

```bash
# Provider CLI (~/.chainpe/config.json → registryAddress) or env:
export CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E

# Consumer wallet MCP / agent:
export CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E
export ERC8004_IDENTITY_REGISTRY=0xB1330d7B1b083ba689C7f56bDf667F1F528a3195
export ERC8004_REPUTATION_REGISTRY=0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543
```

Raw deployment records: `contracts/deployments/avalanche.json`, `contracts/deployments/avalanche-erc8004.json`, `contracts/deployments/avalanche-policyvault.json`, `contracts/deployments/avalanche-icm.json`.

## Hosted services (Avalanche C-Chain)

| Service | URL | Notes |
|---|---|---|
| **Marketplace dashboard** | https://chainpe-dashboard-production-dbd1.up.railway.app | Next.js marketing + docs site |
| **Indexer API** | https://chainpe-indexer-production-f791.up.railway.app | `/services` · `/services/:id` · `/stats` · `/health`; Railway Postgres |
| **Facilitator** | https://chainpe-facilitator-production-000a.up.railway.app | Non-custodial x402 verify+settle; gas key `0x8cC8…8A36` — **needs AVAX funding** |

Deployed on Railway. The indexer's Neon `DATABASE_URL` and the facilitator's gas
key live only in the platform secret store — never in git.

## Mainnet deploy runbook (reference)

**Prerequisites:**
- `DEPLOYER_PRIVATE_KEY` — funded EOA (≥ 2 AVAX for deployment gas)
- `OWNER_ADDRESS` — Gnosis Safe multisig address (create at https://app.safe.global, select Avalanche network)
- `SNOWTRACE_API_KEY` — from https://routescan.io (free tier is fine)

```bash
cd contracts

# 1. Deploy ERC-8004 registries (Identity + Reputation + Validation behind UUPS proxies)
OWNER_ADDRESS=0xYourSafe npm run deploy:erc8004:mainnet

# 2. Deploy ChainPeRegistry (UUPS upgradeable proxy)
#    Uses mainnet USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
OWNER_ADDRESS=0xYourSafe npm run deploy:mainnet

# 3. Deploy PolicyVault (UUPS upgradeable proxy)
OWNER_ADDRESS=0xYourSafe npm run deploy:policyvault:mainnet

# 4. Deploy ICM contracts (same Teleporter address on mainnet: 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf)
OWNER_ADDRESS=0xYourSafe npm run deploy:icm:mainnet

# 5. Run key safety check before going live
npm run check-keys

# 6. Transfer ownership to the Gnosis Safe (initiates two-step handover)
SAFE_ADDRESS=0xYourSafe npm run transfer-ownership:mainnet
# Then open https://app.safe.global → import each contract → call acceptOwnership()

# 7. (Optional) Register ICM trusted sender if using cross-L1 intents
SOURCE_BLOCKCHAIN_ID=0x... TRUSTED_SENDER=0x... npm run configure-icm:mainnet

# 8. Verify on Snowtrace
npm run verify:mainnet  # if a verify script exists; otherwise use: npx hardhat verify --network avalanche <address> <args>
```

**Facilitator mainnet deploy:**

```bash
# In Railway: create a new service "chainpe-facilitator-mainnet"
# Set env vars: NETWORK=avalanche, FACILITATOR_PRIVATE_KEY=<funded key>, ALLOWED_ORIGINS=https://chainpe.app
# Fund the gas key with ≥ 1 AVAX
# Enable health check on /health with 30 s timeout (returns 503 on low gas → triggers restart + alert)
```
