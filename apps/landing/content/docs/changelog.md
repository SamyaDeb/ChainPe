---
title: Changelog
description: What changed in each ChainPe release.
---

## 3.0.0 (November 2026)

ChainPe now runs on Arc, built during ETHGlobal Mumbai.

- Moved to x402 version 2 and Arc.
- Settlement goes through Circle's Facilitator Service, and your API runs only after a payment settles.
- Added Circle Gateway nanopayments, for prices below one cent with no gas.
- Added `ChainPeAccounts`, for provider accounts and the Pro plan, deployed with Arc Studio.
- Service identities now use Arc's official ERC-8004 registries.
- Added `chainpe doctor`, to check a service is ready for agents and Circle's marketplace.
- Added `chainpe-cloud` and the provider dashboard, with verified revenue.
- The SDK, AI tools and MCP wallet moved to Arc, with both payment rails and Circle discovery.
- The npm packages moved to the `@chainpearc` scope. They aren't published yet.

Proof of live payments: [PROOF.md](https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/PROOF.md).

## Earlier versions

ChainPe first ran on Avalanche in June 2026. That version is kept at the tag [`avalanche-june-2026`](https://github.com/SamyaDeb/ChainPe/tree/avalanche-june-2026).
