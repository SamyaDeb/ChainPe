Build the ChainPe provider dashboard as this project's web app (Vite, React, TypeScript, Tailwind, in src/). A developer
registered on ChainPeAccounts signs in with that wallet and sees ONLY their own data. Quick preset.

Read first: context/docs/arc/specs/07-provider-dashboard.md (screens, Free/Pro); context/services/chainpe-cloud/openapi.yaml
(exact paths, params, schemas, error codes); context/services/chainpe-cloud/fixtures/ (real responses);
context/docs/arc/specs/schemas/doctor.schema.json (report in /v1/me/health); abi/ChainPeAccounts.json. This prompt beats spec 07.

HARD LIMITS
- Do NOT touch contracts/, abi/, foundry.toml, remappings.txt. No contract build or deploy. Contract is live at
  0xD315322c9D83A6f50A04236A2a242e0259bfB580 on Arc testnet.
- No keys or secrets. Only the user's wallet signs.
- Use viem directly with window.ethereum. Remove unused starter deps (wagmi, ConnectKit, Circle SDKs, framer-motion,
  react-query, node polyfills) from src/, vite config and package.json. Keep viem pinned and installShareSync() in main.tsx.
- Load src/console-capture.ts and src/tracing.ts in dev only.

AUTH (bearer, no cookies)
Connect wallet; POST /v1/auth/nonce {address, client:'dashboard'}; show the returned message unchanged. If its domain line is not
window.location.host or its address is not the connected one, show a config error and do not request a signature. personal_sign
exactly that string; POST /v1/auth/verify; keep {token,address,expiresAt} in sessionStorage only (never localStorage or the URL).
Authorization: Bearer on every call. Never credentials:'include'.
- 401, or expiresAt passed: clear session, back to sign-in. accountsChanged to another address or disconnect: clear session and
  all cached data, back to sign-in. Logout: POST /v1/auth/logout, then always clear, even if it failed.
- Address comes only from the session, never from the URL.
Errors: not_registered = "Register first" screen with copyable `npx @chainpeavax/cli register --network arc-testnet`;
invalid_siwe = new nonce and retry; chain_unavailable = "Arc could not be read, retry", never shown as unregistered; rate_limited =
wait and retry; plan_required = locked card; anything else = error state with Retry. Never show stale or empty data as real.

API CLIENT
src/api/client.ts, base URL VITE_CHAINPE_CLOUD_URL. Types from openapi.yaml via openapi-typescript into src/api/schema.d.ts, or by
hand. No `any`.

MOCK MODE
On when VITE_USE_MOCK==='true', or in dev with VITE_CHAINPE_CLOUD_URL unset. A production build with neither shows a config error,
never mock data. Copy fixtures byte for byte to src/mock/fixtures/, serve verbatim through the same client interface by lazy import.
Permanent banner: "Sample data, not live". Mock sign-in needs no wallet: Pro provider, Free provider, Unregistered.
Map: me-*, services-*, buyers-*, reputation-*, health-* by plan; summary-24h (24h), summary-free (7d), summary-pro (30d/90d/all);
Free on 30d/90d/all = error-plan-required 403; payments-pro both plans; payments.csv on Pro, 403 on Free; wallets, keys-list,
keys-create, keys-revoke, auth-logout; error-not-registered.

VERIFIED VS UNVERIFIED (the point of this product)
- Revenue tiles use only summary.revenue: totalVerifiedAtomic, exactAtomic, gateway.settledAtomic. gateway.pendingBatchAtomic gets
  its own tile: "Gateway pending: accepted by Circle, batch not landed, can still fail". Never add notRevenue to anything.
- "Not counted as revenue" block, one line each: unverifiedAtomic; failedAtomic (served, then transfer failed); selfPayAtomic;
  unattributedInflowAtomic (USDC with no matching call: faucet, withdrawals, --no-telemetry).
- Note: "Verified means money from that payer reached you. It does not prove an independent customer."
- Payment rows: verification badge with text and shape, not colour alone; verificationReason in plain words; show effectiveTs, not
  ts; self-pay badge. Exact rows link the tx. Gateway rows show gateway.status (received/batched/confirmed/completed/failed; "awaiting
  Circle" if gateway is null) and link gateway.txHash when present.

PLANS
Plan from /v1/me. On plan_required, items null or truncated true: locked card with blurred bars, no digits, feature name, "Upgrade
with USDC" linking to Billing. Free: 24h/7d, 7 days of payments, oldest active service, top 5 buyers, latest doctor result, averages
only. Rail, route, verification filters on BOTH plans. Pro: 30d/90d/all, CSV, all services, all buyers with first/last seen, doctor
history, every review. Do NOT build what the API lacks: per-route revenue or latency, alert channels, 15-minute checks.

SCREENS (path routes, relative links, no #fragment; vercel.json SPA rewrite)
- Overview: range picker; tiles for revenue, paid calls (calls.completed), success rate (null = dash), unique buyers; rail split;
  bar chart of series.points with missing periods as zero (no per-point rail split, do not invent one); Gateway balance from
  services[].gatewayBalanceAtomic; not-counted block.
- Services: name, endpoint as text with copy, price, rails, active, status dot plus text from lastHeartbeatAt (online under 10 min,
  else stale, null = never reported), doctor passed/total, agentId.
- Payments: filters, nextCursor "Load more", CSV by fetch with the header then blob save.
- Buyers: address, spend, calls, first/last seen.
- Reputation: lead large with payerAverage, payerCount: "From wallets that paid you". Smaller: allAverage, allCount: "All ratings,
  including wallets that never paid: anyone can rate an agent". Pro rows: score, client, tags, time, tx link, "Paid you"/"Never paid"
  from fromPayer. score = value / 10^valueDecimals using bigint on strings. agentIdStatus: none = "Run `chainpe identity`"; not_owner
  = "this wallet no longer owns the agent"; unknown = "ownership could not be checked, retry", never "no ratings".
- Listing health: what `chainpe doctor` last reported: score, ok, allGreen, each check's name, status, detail; Pro history. Handle
  empty checks and null doctor.
- Settings: ingest keys (create shows the key once with copy and warning, list, revoke with confirm, never store a key); telemetry
  note; "my wallets" (validate 0x; warn that PUT replaces the list and those payments leave revenue).

LIVE UPDATES
On Overview or Payments with the tab visible, refetch every 3 s so a new payment shows in under 5 s and turns verified. No overlapping
requests. Keep data on screen during refetch.

BILLING (chain 5042002, RPC https://rpc.testnet.arc.io)
- Read proPricePerPeriod(), planOf(address) from VITE_ACCOUNTS_ADDRESS; USDC balanceOf, allowance from VITE_USDC_ADDRESS (0x3600…0000,
  6 decimals, ERC-20 interface). Copy needed ABI fragments to src/lib/accounts.ts as const.
- Show plan, paidUntil, features, periods 1 to 12 (30 days each), total = price*periods in bigint. Visible "Add Arc testnet to wallet"
  button; say so plainly if no injected wallet.
- Upgrade: wrong chain = wallet_switchEthereumChain, on 4902 wallet_addEthereumChain (native USDC, 18 decimals, explorer
  https://explorer.testnet.arc.io). Refuse if balance too low. If allowance < total, approve(accounts, total), wait for receipt. Then
  subscribe(periods), wait for receipt. Check receipt.status on both, show each step and tx link, handle rejection. Re-fetch /v1/me every
  3 s up to 90 s until pro; if unchanged, say the payment landed and the dashboard is catching up. Pro uses the same flow to extend.

SECURITY
- All API and on-chain strings render as text. No dangerouslySetInnerHTML, innerHTML or eval.
- Data links only via src/lib/explorer.ts: explorer.testnet.arc.io/tx/<hash> and /address/<addr>, from values matching
  /^0x[0-9a-fA-F]{64}$/ or /^0x[0-9a-fA-F]{40}$/, else plain text; rel="noopener noreferrer". Never link endpoint, endpointHttps,
  feedbackUri. payer can be the string "unknown".
- Strict CSP in the BUILT index.html only, injected by a vite plugin from env: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src <API origin> https://rpc.testnet.arc.io; base-uri 'none'; form-action 'none'. So no
  inline style attributes: Tailwind classes, and SVG attributes for chart heights.

MONEY
src/lib/money.ts: atomic string to BigInt to display. Above zero and under $0.01 = 6 dp, otherwise 2 dp, half up, bigint only; zero =
$0.00. Never Number or parseFloat on an amount; chart heights by bigint ratio. Tests if a runner exists: 0, 1, 9999, 10000, 10049, 10050,
1000000, above 2^53.

DESIGN
Quiet developer tool: light and dark (prefers-color-scheme plus toggle), one accent, system font, 8 px grid, no gradients. Sidebar on
desktop, bottom tabs under 640 px, tables become cards, no overflow at 375 px. Plan badge and short session address always visible. Every
screen has loading, error, empty states; empty states name the next command (`chainpe start`, `chainpe doctor`, `chainpe login`). Input
labels, visible focus, AA contrast, named copy buttons. Addresses as 0x1234…abcd with copy.

Env: VITE_CHAINPE_CLOUD_URL, VITE_ARC_NETWORK, VITE_ACCOUNTS_ADDRESS, VITE_USDC_ADDRESS, VITE_USE_MOCK. Add .env.example with public
testnet values. Update README and AGENTS.md for mock and live. Finish with typecheck and production build passing; report what changed.
