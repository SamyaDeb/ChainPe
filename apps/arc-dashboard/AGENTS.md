# ChainPe provider dashboard

> Built with Arc Studio - money-powered apps in minutes

Project memory for future agents and humans.

---

## What This App Does

Provider dashboard for ChainPe on Arc. A developer registered on `ChainPeAccounts` signs in with that wallet (SIWE, bearer token in sessionStorage) and sees only their own services, revenue, buyers, ratings, listing health, ingest keys and "my wallets". Free vs Pro follows `/v1/me`. Pro is bought with USDC: `approve` then `subscribe(periods)` from the user's wallet.

Revenue counts verified payments only. Unverified, failed, self-pay and unattributed inflow are shown apart and never added to revenue.

## Tech Stack

- Vite, React 18, TypeScript, Tailwind v3 (oklch CSS variables for light/dark in `src/index.css`, matching `apps/landing`)
- Instrument Serif, Instrument Sans, JetBrains Mono and Poppins, self-hosted through fontsource because the CSP is `font-src 'self'`
- viem 2.57.5 pinned. RainbowKit 2 + wagmi 2 for the wallet connection (`src/lib/wagmi.ts`, `src/auth/WalletProviders.tsx`): MetaMask, Rainbow and a WalletConnect QR code. RainbowKit needs wagmi 2, so do not move to wagmi 3. Do not add smart wallets: their accounts are not deployed on Arc, so ERC-1271 sign-in fails.
- Contracts: Solidity 0.8.28 + Foundry in `contracts/`. Do not edit from the dashboard work.
- Chain: Arc testnet (5042002), RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`
- USDC ERC-20 (6 decimals) `0x3600000000000000000000000000000000000000`. Native gas is USDC with 18 decimals.

## Key Files

- `src/App.tsx` - routes and auth gate. `src/lib/router.tsx` is a small path router (no hash routes).
- `src/auth/` - session, SIWE check (domain must equal `window.location.host`), `useMe`
- `src/api/client.ts` - one typed client over a transport. `src/api/schema.d.ts` - types written from `context/services/chainpe-cloud/openapi.yaml`
- `src/mock/` - mock transport + fixtures copied byte for byte from `context/services/chainpe-cloud/fixtures/`. Loaded by dynamic import.
- `src/lib/money.ts` - atomic string to bigint to display. Never use Number or parseFloat on an amount. Tests: `bun run test`.
- `src/lib/explorer.ts` - the only place that builds links from data.
- `src/billing/useUpgrade.ts` - approve, subscribe, then poll `/v1/me` for up to 90 s.
- `src/screens/` - one file per screen. `src/components/ui/` - shared UI.
- `vite.config.ts` - injects the CSP into the built `index.html` only.

## Mock and live

- Mock mode is on when `VITE_USE_MOCK=true`, or in dev with `VITE_CHAINPE_CLOUD_URL` unset. A permanent "Sample data, not live" banner shows.
- Live mode needs `VITE_CHAINPE_CLOUD_URL`. A production build with neither shows a configuration error and no data.
- The `.env` in the sandbox leaves the cloud URL unset so the preview runs on sample data. `.env.example` lists public testnet values.
- Env changes need a dev server restart.

## Rules to keep

- No inline `style` attributes in our own code: Tailwind classes, SVG attributes for chart sizes. The CSP allows inline styles only because RainbowKit's modal needs them. Scripts stay `'self'` only.
- Sign-in is two taps on purpose (connect, then sign): a phone browser only opens the wallet app from a user gesture.
- Motion lives in `src/index.css` and `src/components/ui/Motion.tsx`. Amounts count up as bigint, and everything respects reduced motion.
- Render all API and onchain strings as text. No `dangerouslySetInnerHTML`. Never link `endpoint` or `feedbackUri`.
- The address comes from the session only, never the URL. Session lives in sessionStorage only.
- Keep `installShareSync()` in `src/main.tsx`. `src/tracing.ts` and `src/console-capture.ts` load in dev only.
- `scripts/` (deploy tooling) still uses two Circle SDK packages, so those stay in `package.json`.

## Usage fee

`src/screens/billing/FeesCard.tsx` shows the fee and asks for a USDC approval. The spender is `FEES_ADDRESS` in `src/lib/env.ts`, never a value from the API: the card refuses to approve if the API reports a different contract. Rules: `docs/arc/specs/12-usage-fees.md`.

## Install

Use `npm ci`, which `vercel.json` also sets. A plain `npm install` fails with ERESOLVE, because the Solana packages that wagmi's connectors pull in clash with a peer range in the Circle SDK. To change dependencies, add `--legacy-peer-deps`. `qr` is pinned to 0.5.5 in `overrides`: RainbowKit's QR renderer asks for `~0`, and qr 0.7 rejects its `border: 0`, which crashes the page when a QR code draws.

## To Run

```bash
bun install
bun run dev
bun run check
bun run build
```

## Deployed contracts

- ChainPeAccounts (Arc testnet): 0xD315322c9D83A6f50A04236A2a242e0259bfB580, tx 0xc6fc0f559ded0557ac36e2f306d6cbe311f6be2d614ebb0318d15bef72f12497. Supersedes 0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb (no payTo check). Owner and treasury 0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a. ABI in abi/ChainPeAccounts.json. `planOf` returns 1 for Pro, 0 for Free. PolicyVault is planned for a later run.
