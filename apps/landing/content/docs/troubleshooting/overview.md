---
id: troubleshooting-overview
title: Troubleshooting Overview
sidebar_position: 1
---

# Troubleshooting

Quick links to common issues:

- [Common Issues](./common-issues.md) — top 10 problems with solutions
- [FAQ](../faq.md) — frequently asked questions

## Getting help

- **GitHub Issues:** [github.com/SamyaDeb/ChainPe/issues](https://github.com/SamyaDeb/ChainPe/issues)
- **Discord:** [discord.gg/chainpe](https://discord.gg/chainpe)
- **Live service status:** [chainpe-facilitator-production.up.railway.app/health](https://chainpe-facilitator-production.up.railway.app/health)

## Quick diagnostic checklist

Before filing an issue, run through:

1. Is your `CHAINPE_PRIVATE_KEY` valid? Check with `chainpe status`.
2. Do you have USDC on Avalanche C-Chain? Obtain from a CEX or bridge (e.g. [Stargate](https://stargate.finance)). For Fuji testnet development, get test USDC at [faucet.circle.com](https://faucet.circle.com/).
3. Is the facilitator up? `curl https://chainpe-facilitator-production.up.railway.app/health`
4. Is the indexer up? `curl https://chainpe-indexer-production.up.railway.app/health`
5. Is the network set correctly? Use `network: 'avalanche'` for mainnet.
6. Is the registry address set? `CHAINPE_REGISTRY_ADDRESS=0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` (mainnet)
