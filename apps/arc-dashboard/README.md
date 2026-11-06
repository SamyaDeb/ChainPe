# ChainPe provider dashboard

A web dashboard for ChainPe providers on Arc. Sign in with the wallet you registered with and see only your own services, verified revenue, buyers, ratings and listing health. Upgrade from Free to Pro by paying USDC from your wallet.

Built with [Arc Studio](https://studio.arc.io)

The `ChainPeAccounts` smart contract lives in `contracts/` (see `contracts/README.md`). It is already deployed on Arc testnet and this app does not change it.

## Tech stack

- Vite, React, TypeScript, Tailwind CSS
- viem with an injected browser wallet (MetaMask, Rabby)
- Arc testnet, USDC

## Development

Prerequisites: [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env   # optional
bun run dev
```

With `VITE_CHAINPE_CLOUD_URL` unset, the dev server runs on sample data (no wallet needed) and shows a permanent "Sample data, not live" banner. Sign in as a Pro provider, a Free provider, or an unregistered wallet.

To use live data, set `VITE_CHAINPE_CLOUD_URL` to the ChainPe backend and sign in with a registered wallet. The backend's sign-in domain must match the host this app is served from.

### Environment variables

All values are public. Never put a secret in a `VITE_` variable.

| Name | Purpose |
| --- | --- |
| `VITE_CHAINPE_CLOUD_URL` | Base URL of the ChainPe backend. |
| `VITE_USE_MOCK` | Set to `true` to serve sample data, in dev or in a build. |
| `VITE_ARC_NETWORK` | `arc-testnet`, the only network supported today. |
| `VITE_ACCOUNTS_ADDRESS` | `ChainPeAccounts` contract address on Arc testnet. |
| `VITE_USDC_ADDRESS` | USDC token address on Arc testnet. |

A production build needs `VITE_CHAINPE_CLOUD_URL` (or `VITE_USE_MOCK=true`). Without either, the app shows a configuration error instead of data.

### Scripts

```bash
bun run dev        # start the dev server
bun run build      # typecheck and build to dist/
bun run preview    # serve the built app
bun run test       # money formatting tests
bun run check      # lint and typecheck
```

The build injects a strict Content-Security-Policy into `dist/index.html`. It allows connections to the backend origin and `https://rpc.testnet.arc.io` only.

### Deploying

Serve `dist/` as a single-page app. `vercel.json` and `public/_redirects` send every path to `index.html`.

### Contracts

```bash
bun run contracts:build
bun run contracts:test
```
