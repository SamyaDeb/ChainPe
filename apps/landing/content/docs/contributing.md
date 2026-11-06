---
title: Contributing
description: Build ChainPe from source and find your way around the repo.
---

## Build and test

```bash
git clone https://github.com/SamyaDeb/ChainPe.git
cd ChainPe
git checkout arc
npm install
cp .env.example .env   # fill in your test keys
npm run build
npm test
```

ChainPe needs Node.js 22.18 or newer. Never commit a private key or a `.env` file.

## Repo map

| Folder | What's inside |
|---|---|
| `packages/chainpe` | The CLI and the paying proxy |
| `packages/chainpe-sdk` | The buyer SDK |
| `packages/chainpe-ai-tools` | Vercel AI SDK and LangChain tools |
| `packages/chainpe-wallet` | The MCP wallet |
| `contracts-arc` | `ChainPeAccounts` and its tests (Foundry) |
| `services/chainpe-cloud` | The API behind the dashboard |
| `apps/landing` | This site and its docs |
| `apps/arc-dashboard` | The provider dashboard |
| `examples/arc-demo` | The live demo seller |
| `docs/arc` | Plan, specs, reviews and proof |

Other folders hold code from the first version of ChainPe, and `packages/chainpe-agent` hasn't moved to Arc yet. See [`docs/STRUCTURE.md`](https://github.com/SamyaDeb/ChainPe/blob/arc/docs/STRUCTURE.md).

## Ground rules

- Use Circle's services for settlement, nanopayments and discovery, rather than rebuilding them.
- Never forward a request to the provider's API before settlement is final.
- Use the ERC-20 interface for USDC amounts, which has 6 decimals.
- Work on the `arc` branch, in small commits.

## License

[MIT](https://github.com/SamyaDeb/ChainPe/blob/arc/LICENSE)
