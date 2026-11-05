Build the ChainPe provider dashboard as the web app of this project (Vite + React + TypeScript, in src/).
ChainPe lets developers sell API calls to AI agents on Arc. A developer who registered on the
ChainPeAccounts contract signs in with the same wallet and sees ONLY their own data.
Specs in context: context/docs/arc/specs/07-provider-dashboard.md (screens, rules) and
context/docs/arc/specs/08-chainpe-cloud-api.md (the API you call). Follow them.

Data and auth
- All data comes from the chainpe-cloud API at import.meta.env.VITE_CHAINPE_CLOUD_URL.
  Endpoints: POST /v1/auth/nonce, POST /v1/auth/verify, POST /v1/auth/logout, GET /v1/me,
  /v1/me/services, /v1/me/summary?range=, /v1/me/payments?cursor=&rail=&route=, /v1/me/payments.csv,
  /v1/me/buyers, /v1/me/reputation, /v1/me/health, POST/GET/DELETE /v1/keys, PUT /v1/me/wallets.
  Send credentials: 'include'. Never take the address from the URL.
- Sign-in: connect an injected wallet (viem), request /v1/auth/nonce, personal_sign the returned message,
  POST /v1/auth/verify. A 403 not_registered shows a "Register first" screen with the copyable command
  `npx @chainpeavax/cli register --network arc-testnet`.
- If VITE_USE_MOCK=true, serve all endpoints from src/mock/*.json fixtures (create realistic fixtures:
  2 services, 40 payments across rails exact and gateway, 6 buyers, 5 feedback entries, plan Free) so the
  UI works before the API is deployed.

On-chain (Arc testnet, chain id 5042002, RPC https://rpc.testnet.arc.io, explorer https://explorer.testnet.arc.io)
- Add-network helper for the wallet; native currency USDC with 18 decimals.
- Billing screen: Upgrade to Pro = USDC.approve(VITE_ACCOUNTS_ADDRESS, price * periods) on
  0x3600000000000000000000000000000000000000 (6 decimals), then ChainPeAccounts.subscribe(periods).
  Read proPricePerPeriod and planOf from the contract (ABI at abi/ChainPeAccounts.json in this workspace).
  Show tx links. Refresh /v1/me after confirmation.

Screens (see spec 07 for Free vs Pro): Sign in, Overview, Services, Payments, Buyers, Reputation,
Listing health, Billing, Settings. Locked Pro sections show a blurred preview and an "Upgrade with USDC"
button; never invent numbers.

Formatting rules
- USDC amounts arrive as atomic strings (6 decimals). Show 6 dp under $0.01, else 2 dp.
- Self-pay rows get a badge and are excluded from revenue totals.
- Payer addresses shortened 0x1234…abcd with copy button; tx hashes link to the explorer.
- Empty states tell the next CLI command (chainpe start, chainpe doctor, chainpe login).

Design
- Clean, quiet developer-tool look: light and dark themes, one accent colour, system font, 8px grid,
  no gradients. Left sidebar on desktop, bottom tabs under 640px; tables become cards on mobile.
- Overview: four stat tiles (revenue, paid calls, success rate, unique buyers), a revenue-by-day bar
  chart split by rail, a Gateway balance card.

Env vars: VITE_CHAINPE_CLOUD_URL, VITE_ARC_NETWORK, VITE_ACCOUNTS_ADDRESS, VITE_USDC_ADDRESS, VITE_USE_MOCK.
Write a short README in the project root explaining how to run it with mock data and against the API.
