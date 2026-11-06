# Provider dashboard review (Phase 6, H4)

Reviewed 2026-11-06: Studio run 2 (`01a1af33-05bb-768e-9d2c-e340331edfc7`) pulled to `apps/arc-dashboard`. I read the auth, API client,
money, explorer, billing and screen code, and ran the production mock build in Chromium at 375 and 1280 px, light and dark, Free and Pro.

The fixes go through Studio (`prompts/studio-02b-fixes.md`) so the workspace stays the source. The status column is updated after run 2b.

## Findings

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | High | Money | Upgrade: if a receipt wait fails after the tx is sent, the error reads as a failure and the pay button is live again, so a retry can pay twice | run 2b |
| 2 | Medium | Trust | "Verified revenue" uses `totalVerifiedAtomic`, which the API computes as exact + settled + **pending**. With a separate pending tile beside it, it reads as if pending were excluded. The chart has the same issue | run 2b |
| 3 | Medium | Spec | Billing never reads `planOf()`. The ABI fragment exists but nothing calls it (H1 requires it) | run 2b |
| 4 | Medium | Security | No `frame-ancestors`: a meta CSP cannot set it, so the page can be framed over wallet-triggering buttons | run 2b |
| 5 | Medium | Reliability | `fetch` has no timeout. A hung request stalls the no-overlap poller for good, and a hung logout never clears the session | run 2b |
| 6 | Medium | Accuracy | "Never paid" overclaims: `fromPayer` is also false for wallets whose payments are unverified or self-pay | run 2b |
| 7 | Medium | Money format | Gateway balance, service price and Billing balance/allowance use the exact formatter, not the 6 dp / 2 dp rule | run 2b |
| 8 | Low | Isolation | A restored session is not compared with the wallet's current account after a reload (`accountsChanged` only fires live). Data stays scoped to the token, but the UI can show one address while the wallet is on another | run 2b |
| 9 | Low | Billing | A low-balance or RPC error before approval is shown on the "Switch network" step | run 2b |
| 10 | Low | Efficiency | A `plan_required` answer keeps polling every 6 s forever | run 2b |
| 11 | Low | Accessibility | Light-mode `ok` on `ok-soft` is 4.43:1, under AA. Dark mode and all other text pairs pass | run 2b |
| 12 | Low | Accessibility | The range picker declares `role="radio"` without the arrow-key behaviour that role promises | run 2b |
| 13 | Low | Layout | The fixed "Built with Arc Studio" pill covers table rows at 375 px | run 2b |
| 14 | Low | Layout | Bottom tabs scroll with no affordance at 375 px: Billing and Settings start off-screen. "All time" is clipped in the range picker | run 3 |
| 15 | Low | Bundle | One 532 KB chunk (164 KB gzip): viem, ox and noble make up most of it. No unused SDK is bundled. Vendor chunks silence the warning and help caching | run 2b |

## Checked, no issue

- **Token handling:** `sessionStorage` only, never in a URL, `credentials: 'omit'`. Cleared on 401, expiry, account change, disconnect and logout.
- **Sign-in:** the domain and address are checked before any signature is requested. The message is shown unchanged and signed exactly as received.
- **XSS:** no `dangerouslySetInnerHTML`, `innerHTML` or `eval`. Untrusted strings render as text, and endpoints and feedback URIs are never linked.
- **Explorer links:** one helper, strict 0x validation, `noopener noreferrer`. Anything else renders as text.
- **CSP:** present in the built HTML. In a real browser: no violations on any screen, and CSV blob download works.
- **Isolation:** the address comes only from the session, `/v1/me` is checked against it, and the app remounts per token.
- **Plan gating:** driven by API answers (`plan_required`, `items: null`, `truncated`), with no client-side data invented. Locked cards show no digits.
- **Money:** bigint only, with tests including values above 2^53. The one `Number()` on a ratio is bounded.
- **Keys:** a new key lives in component state only, and revoke needs a confirm.
- **Build:** `npm ci`, typecheck, lint, money tests and build pass. The lock file includes Linux x64 builds of rollup, esbuild and TypeScript.

## Accepted, not changed

- **$0.011 shows as $0.01** next to $0.01 and $0.001000, so the tiles can look like they do not add up. That is the formatting rule as specified.
- **Rows already loaded by "Load more" are not re-polled**, so an older row's badge updates on reload. Page one is live, and new payments land there.
- **`Retry-After` is not exposed by CORS** on chainpe-cloud, so the dashboard uses its fallback wait. A small API fix, not worth a deploy now.
- **Two Circle SDKs remain in `package.json`** because Studio's deploy scripts import them. They are not in the bundle.

## Left out because the API has no data

Per-route revenue and latency, alert channels and 15-minute checks (spec 07 Pro rows). Nothing is faked; see `BUSINESS-MODEL.md` stretch items.

## Prompt conflict found

`prompts/studio-03-review.md` told Studio to fix contract findings and redeploy. Phase 6 forbids contract changes, so run 3 is limited to the dashboard.
