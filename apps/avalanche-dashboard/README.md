# ChainPe provider dashboard (Avalanche)

A web dashboard for ChainPe providers on Avalanche C-Chain. Sign in with the wallet that registered your service in
`ChainPeRegistry` and see only your own services, verified revenue, buyers, ERC-8004 ratings and listing health.

It is the Arc dashboard (`apps/arc-dashboard` on the `arc` branch) ported to Avalanche. The backend is
[`services/chainpe-cloud`](../../services/chainpe-cloud).

## What changed from Arc

- **Chain:** Avalanche C-Chain (43114), explorer snowtrace.io, gas in AVAX.
- **Who is a provider:** any wallet with a service in `ChainPeRegistry`. Registering is done with the CLI
  (`npx @chainpeavax/cli init`, then `register`). The registry charges a one-time 1 USDC fee.
- **No Billing, no plans, no usage fee.** Avalanche has no account or fee contract, so every provider gets what
  Pro gave on Arc: every range, every service, every buyer, every review, CSV export.
- **Payments are read from the chain.** The backend counts a USDC transfer to a service's payout address for
  exactly its price as a verified payment. Payments shows these as "On-chain" and proxy-reported ones as "Proxy".
- **Exact rail only.** No Circle Gateway, so the rail split and Gateway balance are gone.
- **Listing health** stays, but stays empty until a proxy sends heartbeats. The Avalanche CLI does not yet.

## Development

```bash
npm ci --legacy-peer-deps
npm run dev
```

With `VITE_CHAINPE_CLOUD_URL` unset, the dev server runs on sample data (no wallet needed) and shows a permanent
"Sample data, not live" banner. Sign in as the sample provider or as an unregistered wallet. The sample data in
`src/mock/fixtures` is copied from `services/chainpe-cloud/fixtures`, which the backend's contract test writes from
real responses.

To use live data, set `VITE_CHAINPE_CLOUD_URL` to the backend. The backend's `SIWE_DOMAIN` must equal the host this
app is served from, and `CORS_ORIGIN` its origin.

| Name | Purpose |
| --- | --- |
| `VITE_CHAINPE_CLOUD_URL` | Base URL of chainpe-cloud. |
| `VITE_USE_MOCK` | `true` serves sample data, in dev or in a build. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Optional. `src/lib/env.ts` holds ChainPe's. Add this app's domain to its allowlist at dashboard.reown.com. |
| `VITE_BASE_PATH` | Path prefix, e.g. `/dashboard/`. Empty serves at the root. |

## Checks

```bash
npm run check   # oxlint + tsc
npm test        # money formatting
npm run build
```
