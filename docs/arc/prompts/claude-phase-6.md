You are a senior x402 / EVM payments engineer and front-end lead continuing the ChainPe → Arc port.
Phases 1–5 are done and verified live. Phase 6 = the personalised provider dashboard (the business-model
surface), BUILT IN ARC STUDIO and driven by you through the arc-studio CLI, then reviewed, hardened and
deployed by you. Judges will open the Studio workspace, so the dashboard must live in the same Studio app
as the contracts. Every number on screen comes from chainpe-cloud and must show whether it is verified.

Read first: CLAUDE.md, docs/arc/BUILD-PLAN.md (Phase 6), docs/arc/ARC-STUDIO.md (runs 2–3),
docs/arc/specs/07-provider-dashboard.md, docs/arc/specs/08a-cloud-design.md (esp. §2 session transport,
§3 trust model, §6 plan gating, §12 found live), services/chainpe-cloud/openapi.yaml and fixtures/*,
docs/arc/prompts/studio-02-dashboard.md, studio-03-review.md, docs/arc/STUDIO-LOG.md, docs/arc/PROOF.md,
contracts-arc/abi/, and `arc-studio agent-guide`.

Verified state (checked 2026-11-06 10:10 IST)
- Studio app (contracts already there): https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a
- ChainPeAccounts 0xD315322c9D83A6f50A04236A2a242e0259bfB580 (Arc testnet), Pro = 1 USDC / 30 days on testnet.
- Seller 0x261f…2e73: Pro, agentId 897796 (ownerOf confirmed), 4 services on-chain in total.
  Buyer wallet is a FREE provider (use it to show locked Pro views). Third wallet
  0x641Be3d2064498142542BDA5a7b5a24A0bB52e4d is unregistered (403 not_registered).
- Demo seller live: https://chainpe-arc-demo-production.up.railway.app (402 with exact + Gateway on
  /forecast, Gateway only on /weather, admin 401, discovery docs GET/HEAD only).
- chainpe-cloud live: https://chainpe-cloud-production.up.railway.app — bearer JWT (12 h, HS256),
  no cookies, strict CORS allowlist; indexer at chain head; tsc green, 139 vitest cases.
- Live API returns SIWE domain `dashboard-not-deployed.invalid` for dashboard sign-ins and no CORS
  origin: SIWE_DOMAIN and CORS_ORIGIN are placeholders until this phase deploys the dashboard.
  (CLI login uses the API's own host via `client: 'cli'`, so it is unaffected.)

PART G — fixes found in review (before the dashboard; one commit each, prefix `arc:`)
G1. 402 `resource.url` is http:// on Railway (TLS ends at Railway's proxy). Build resource URLs from
    config.publicUrl when set (else trust the first X-Forwarded-Proto hop: `app.set('trust proxy', 1)`
    only when publicUrl is unset). Test: behind a fake proxy, resource.url is https and equals
    publicUrl + path (+ query). Re-run `chainpe doctor` against the live seller; check 12 compares
    `resource` exactly, so this matters for Circle listing.
G2. Unsolicited ratings (08a §12: agentId 897796 got an 80 from a wallet that never paid). In
    chainpe-cloud, mark each feedback `fromPayer` = client address has ≥1 verified payment to this
    provider; /v1/me/reputation returns `payerAverage`, `allAverage`, counts, and the flag per row.
    Update openapi.yaml + fixtures + tests. The dashboard leads with the payer average.

PART H — Phase 6 dashboard through Arc Studio

H0. Preflight: arc-studio doctor; arc-studio usage --json (stop if < 30% left and tell me);
    arc-studio apps --json shows 6872b96e…; run Studio commands from the repo root so the same app is used.
H1. Rewrite docs/arc/prompts/studio-02-dashboard.md to match reality (it predates Phase 5 and is wrong):
    - Bearer token, not cookies: sign in with injected wallet → POST /v1/auth/nonce {address, client:
      'dashboard'} → personal_sign the returned message (show it to the user unchanged) → POST
      /v1/auth/verify → keep the token in sessionStorage only; Authorization: Bearer on every call; on 401
      clear it and return to sign-in. Never use credentials:'include'.
    - Use the exact paths, params, response schemas and error codes from openapi.yaml; generate a typed
      client from it (openapi-typescript or hand types — no `any`).
    - Mock mode (VITE_USE_MOCK=true) serves services/chainpe-cloud/fixtures/*.json verbatim.
    - Verified vs unverified: revenue tiles use verified totals; unverified/pending shown separately with
      an explanation; Gateway rows show status (received / batched / completed / failed) and link the batch
      tx when present; exact rows link the tx.
    - Free vs Pro from /v1/me plan; `plan_required` → locked card with "Upgrade with USDC" (no fake data).
    - Billing: read proPricePerPeriod() and planOf() from ChainPeAccounts (ABI from contracts/ in the Studio
      app); Upgrade = USDC.approve(accounts, price*periods) on 0x3600…0000 then subscribe(periods); wait for
      receipts; re-fetch /v1/me. Add-Arc-testnet-to-wallet helper (chainId 5042002, native USDC 18 decimals).
    - Security: render all on-chain/API strings as text (no dangerouslySetInnerHTML); links only to
      explorer.testnet.arc.io built from validated 0x hashes/addresses; address always from the session,
      never from the URL; strict CSP meta (connect-src to the API + RPC only).
    - Money: atomic strings → bigint → formatted at the edge (6 dp under $0.01, else 2 dp). No floats.
    - Screens and Free/Pro rules from spec 07, plus Reputation showing payer average first (G2).
    - Mobile at 375 px, light/dark, empty states that name the next CLI command.
    Keep it under 10,000 chars.
H2. Studio run 2:
      arc-studio run --prompt-file docs/arc/prompts/studio-02-dashboard.md \
        --file docs/arc/specs/07-provider-dashboard.md \
        --file services/chainpe-cloud/openapi.yaml \
        --file services/chainpe-cloud/fixtures/ \
        --output json > .arc-studio/run2.json
    Handle needs_input from the specs only (else ask me); budget_exceeded → stop. Read fileDiffs. Studio
    must NOT modify contracts/ — reject the run if it did.
H3. Pull into apps/arc-dashboard (src/**, index.html, package.json, vite.config.*, tsconfig*, public/**;
    check `arc-studio ls` first). Make it build locally: npm ci && npm run build && npm run lint/typecheck.
    The lock file must include Linux native builds (Vercel builds on Linux; Phase 5 hit this on Railway).
H4. Your review (docs/arc/reviews/dashboard-review.md), then fix through Studio so the workspace stays the
    source (round-trip files with `--file local:workspace/path`, prompt in studio-02b-fixes.md), checking:
    token handling and XSS paths, CSP, isolation (UI never shows data not returned for this token),
    plan gating vs API, money formatting, error/loading/empty states, explorer links, accessibility
    (labels, contrast, keyboard), bundle size, and that mock fixtures and live API render the same.
H5. Studio run 3 with studio-03-review.md (polish, 375 px and 1280 px, light/dark). Pull again.
H6. Deploy apps/arc-dashboard (Vercel, Linux build). Then tell me the exact Railway variables to change on
    chainpe-cloud: SIWE_DOMAIN = dashboard host, CORS_ORIGIN = https://<dashboard host>; I set them.
    Re-test CLI login after the change (must still work via client 'cli').
H7. Live acceptance (Arc testnet, live API, live demo seller):
    - Seller wallet: sees only its services; revenue split exact vs Gateway with verified totals; buyers;
      reputation with payer average; doctor status; Gateway payment from a fresh paid call appears < 5 s
      and turns verified.
    - Buyer wallet (Free): 7-day window, locked Pro cards; upgrade flow works with 1 USDC on testnet and
      the badge flips to Pro (record the txs).
    - Third wallet: "Register first" screen with the CLI command.
    - Logout revokes the token (API returns 401 afterwards).
    - Studio workspace URL shows contracts + dashboard; run 2/2b/3 rows filled in STUDIO-LOG.md.
    - Append to PROOF.md (upgrade txs, dashboard URL); tick Phase 6 in BUILD-PLAN.md.

Rules
- The dashboard holds no keys; only the user's wallet signs. Never send .env or keys to Studio.
- Do not change contracts or redeploy them in this phase. Do not touch SDK/wallet/agent (Phase 7).
- API contract changes (G2) go through openapi.yaml + fixtures + tests first, then the dashboard.
- Stop and ask me at: low Studio budget, Studio needs input the specs don't cover, Vercel/Railway
  settings, and anything that spends funds beyond the 1 USDC upgrade test.

Report at the end: G1/G2 results, Studio runs (status, webUrl, traceId), review findings and fixes,
build output, dashboard URL, H7 evidence with tx links and screenshots described, files changed,
commits, and open items for Phase 7.
