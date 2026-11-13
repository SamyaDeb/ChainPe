---
id: smart-contracts-overview
title: Smart Contracts Overview
sidebar_position: 1
slug: /smart-contracts/overview
---

# Smart Contracts

All ChainPe contracts are written in Solidity 0.8.28 and use OpenZeppelin libraries. The test suite has 44+ passing tests.

## Deployed addresses (Avalanche C-Chain, mainnet, chainId 43114)

Deployed 2026-06-17. Deployer / owner: `0x8cC8dADfAd2D39659314106bAf4Da10B3BA38A36`.

| Contract | Address | Notes |
|---|---|---|
| **ChainPeRegistry** (proxy) | [`0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`](https://snowtrace.io/address/0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E#code) | Verified on Snowtrace, UUPS proxy |
| PolicyVault (proxy) | [`0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8`](https://snowtrace.io/address/0xFe38A9fE7bdA837549fed1b3608d138Bd9a168d8) | UUPS proxy |
| ERC-8004 IdentityRegistry (proxy) | [`0xB1330d7B1b083ba689C7f56bDf667F1F528a3195`](https://snowtrace.io/address/0xB1330d7B1b083ba689C7f56bDf667F1F528a3195) | UUPS proxy |
| ERC-8004 ReputationRegistry (proxy) | [`0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543`](https://snowtrace.io/address/0xfe7Df66e6BFbd3A76B68dDF26b9312E6c85a38543) | UUPS proxy |
| ERC-8004 ValidationRegistry (proxy) | [`0x91477bD9211448a85eFb16ea858432a85d89b833`](https://snowtrace.io/address/0x91477bD9211448a85eFb16ea858432a85d89b833) | UUPS proxy |
| ChainPeICMReceiver | [`0xc8aBD919F597C46dA889e76704F69A2809cd6D33`](https://snowtrace.io/address/0xc8aBD919F597C46dA889e76704F69A2809cd6D33) | no proxy |
| ChainPeICMSender | [`0x097D7D4B46CB894142a72E91c3b8F8b5834255dF`](https://snowtrace.io/address/0x097D7D4B46CB894142a72E91c3b8F8b5834255dF) | no proxy |

## Network configuration

| Network | Chain ID | USDC Address | Explorer |
|---|---|---|---|
| Avalanche (mainnet) | 43114 | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | [snowtrace.io](https://snowtrace.io) |
| Fuji (testnet) | 43113 | `0x5425890298aed601595a70AB815c96711a31Bc65` | [testnet.snowtrace.io](https://testnet.snowtrace.io) |

## Registry config (mainnet)

- Fee token: USDC (`0xB97E...6a6E`)
- Registration fee: **0.1 USDC** (100000 atomic)
- Update fee: **0 USDC** (free updates)
- Identity registry linked: yes (`0xB133...3195`)

## Source files

| Contract | Source |
|---|---|
| ChainPeRegistry | `contracts/contracts/ChainPeRegistry.sol` |
| ChainPeRegistryUpgradeable | `contracts/contracts/ChainPeRegistryUpgradeable.sol` |
| PolicyVault | `contracts/contracts/PolicyVault.sol` |
| PolicyVaultUpgradeable | `contracts/contracts/PolicyVaultUpgradeable.sol` |
| ChainPeICMSender | `contracts/contracts/icm/ChainPeICMSender.sol` |
| ChainPeICMReceiver | `contracts/contracts/icm/ChainPeICMReceiver.sol` |
| IdentityRegistryUpgradeable | `contracts/contracts/erc8004/IdentityRegistryUpgradeable.sol` |
| ReputationRegistryUpgradeable | `contracts/contracts/erc8004/ReputationRegistryUpgradeable.sol` |
| ValidationRegistryUpgradeable | `contracts/contracts/erc8004/ValidationRegistryUpgradeable.sol` |

## Detailed references

- [ChainPeRegistry](./chainpe-registry.md) — service marketplace, events, access control
- [PolicyVault](./policy-vault.md) — gasless spending policies
- [ICM Receiver](./icm-receiver.md) — cross-chain payment intents
- [Upgradeable Contracts](./upgradeable-contracts.md) — UUPS proxy pattern and upgrade process
