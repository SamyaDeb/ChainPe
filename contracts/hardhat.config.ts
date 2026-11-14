import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

// Load .env from the contracts workspace and the repo root (root takes lower priority).
dotenv.config();
dotenv.config({ path: "../.env" });

// ============================================================================
// Secrets (NEVER hardcode — read from environment / gitignored .env)
// ============================================================================
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
// Routescan's Snowtrace-compatible verify endpoint accepts any non-empty key.
const SNOWTRACE_API_KEY = process.env.SNOWTRACE_API_KEY || "routescan";

const FUJI_RPC_URL =
  process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc";
const AVALANCHE_RPC_URL =
  process.env.AVALANCHE_RPC_URL ?? "https://api.avax.network/ext/bc/C/rpc";
// Phase 5: the Fuji L1 that holds ChainPeReputationMirror. Defaults to the public Echo L1.
const L1_RPC_URL =
  process.env.L1_RPC_URL ?? "https://subnets.avax.network/echo/testnet/rpc";
const L1_CHAIN_ID = parseInt(process.env.L1_CHAIN_ID ?? "173750", 10);

// Only attach an account if a key is present, so `hardhat compile`/`test`
// work without any secrets configured.
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

// When MAINNET_FORK=true, the default hardhat network forks Avalanche mainnet.
const MAINNET_FORK = process.env.MAINNET_FORK === "true";
const FORK_BLOCK   = parseInt(process.env.FORK_BLOCK ?? "88232363", 10);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 1000 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337, hardfork: "cancun" },
    fuji: {
      url: FUJI_RPC_URL,
      chainId: 43113,
      accounts,
    },
    avalanche: {
      url: AVALANCHE_RPC_URL,
      chainId: 43114,
      accounts,
    },
    l1: {
      url: L1_RPC_URL,
      chainId: L1_CHAIN_ID,
      accounts,
    },
  },
  // Snowtrace verification (Etherscan-compatible API).
  etherscan: {
    apiKey: {
      avalancheFujiTestnet: SNOWTRACE_API_KEY,
      avalanche: SNOWTRACE_API_KEY,
    },
    customChains: [
      {
        network: "avalancheFujiTestnet",
        chainId: 43113,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
      {
        network: "avalanche",
        chainId: 43114,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
          browserURL: "https://snowtrace.io",
        },
      },
    ],
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
