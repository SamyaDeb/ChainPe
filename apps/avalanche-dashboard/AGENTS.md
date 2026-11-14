# ChainPe provider dashboard (Avalanche)

Project memory for future agents and humans. Ported from the Arc dashboard on the `arc` branch.

---

## What This App Does

Provider dashboard for ChainPe on Avalanche C-Chain. A developer with a service in `ChainPeRegistry` signs in with that wallet (SIWE, bearer token in sessionStorage) and sees only their own services, revenue, buyers, ratings, listing health, ingest keys and "my wallets". Avalanche has no paid plan: the API always reports `plan: "pro"`, and there is no Billing screen or usage fee.

Revenue counts verified payments only. On Avalanche the backend reads payments from USDC transfers (a transfer to a payTo for exactly the service price). Unverified, failed, self-pay and unattributed inflow are shown apart and never added to revenue.

## Tech Stack

- Vite, React 18, TypeScript, Tailwind v3 (oklch CSS variables for light/dark in `src/index.css`)
- Instrument Serif, Instrument Sans, JetBrains Mono and Poppins, self-hosted through fontsource because the CSP is `font-src 'self'`
- viem 2.57.5 pinned. RainbowKit 2 + wagmi 2 (`src/lib/wagmi.ts`, `src/auth/WalletProviders.tsx`). RainbowKit needs wagmi 2, so do not move to wagmi 3. No smart wallets: an undeployed account fails ERC-1271 sign-in.
- Chain: Avalanche C-Chain (43114), RPC `https://api.avax.network/ext/bc/C/rpc`, explorer `https://snowtrace.io`
- USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (6 decimals). Gas is AVAX.

## Key Files

- `src/App.tsx` - routes and auth gate. `src/lib/router.tsx` is a small path router (no hash routes).
- `src/auth/` - session, SIWE check (domain must equal `window.location.host`), `useMe`
- `src/api/client.ts` - one typed client over a transport. `src/api/schema.d.ts` - types written from `services/chainpe-cloud/openapi.yaml`
- `src/mock/` - mock transport + fixtures copied byte for byte from `services/chainpe-cloud/fixtures/`. Loaded by dynamic import.
- `src/lib/money.ts` - atomic string to bigint to display. Never use Number or parseFloat on an amount. Tests: `npm test`.
- `src/lib/explorer.ts` - the only place that builds links from data.
- `src/screens/` - one file per screen. `src/components/ui/` - shared UI.
- `vite.config.ts` - injects the CSP into the built `index.html` only (connect-src: API, api.avax.network, WalletConnect, and `https:` for the Explore page's "Try it", which calls registered service endpoints).

## Mock and live

- Mock mode is on when `VITE_USE_MOCK=true`, or in dev with `VITE_CHAINPE_CLOUD_URL` unset. A permanent "Sample data, not live" banner shows.
- Live mode needs `VITE_CHAINPE_CLOUD_URL`. A production build with neither shows a configuration error and no data.
- Env changes need a dev server restart.

## Rules to keep

- No inline `style` attributes in our own code: Tailwind classes, SVG attributes for chart sizes. The CSP allows inline styles only because RainbowKit's modal needs them. Scripts stay `'self'` only.
- Sign-in is two taps on purpose (connect, then sign): a phone browser only opens the wallet app from a user gesture.
- Motion lives in `src/index.css` and `src/components/ui/Motion.tsx`. Amounts count up as bigint, and everything respects reduced motion.
- Render all API and onchain strings as text. No `dangerouslySetInnerHTML`. Never link `endpoint` or `feedbackUri`.
- The address comes from the session only, never the URL. Session lives in sessionStorage only.

## Install

`npm ci --legacy-peer-deps` (also what `vercel.json` runs): wagmi's optional connectors pull in Solana packages with a clashing peer range. `qr` is pinned to 0.5.5 in `overrides`: RainbowKit's QR renderer asks for `~0`, and qr 0.7 rejects its `border: 0`, which crashes the page when a QR code draws.

## To Run

```bash
npm ci --legacy-peer-deps
npm run dev
npm run check
npm run build
```

## Contracts (Avalanche mainnet, contracts/deployments)

- ChainPeRegistry proxy `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E`, deployed at block 88208064. 1 USDC registration fee.
- ERC-8004 identity `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195`, reputation `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543`.
