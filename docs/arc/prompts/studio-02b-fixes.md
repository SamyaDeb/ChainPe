Fix these review findings in the ChainPe provider dashboard. The files were sent back in place; edit them there. Change only what each item
needs. Do NOT touch contracts/, abi/, foundry.toml, remappings.txt. No contract build or deploy. Quick preset.

1. src/billing/useUpgrade.ts: after a tx hash exists, a failed receipt wait must not read as a failed payment. Say: "This transaction was sent,
   but its result could not be read. Check the link before paying again." Add a `sent` state the hook returns, true once subscribe was sent and
   its outcome is unknown. In src/screens/Billing.tsx, keep the pay button disabled while `sent` is true, with a "Check again" button that re-reads the
   receipt by hash and clears `sent` once it is known. Reverted receipts stay plain failures.
2. src/screens/Overview.tsx: the API's totalVerifiedAtomic = exact + settled + pending. Keep the "Verified revenue" tile, with this hint when pending is above zero:
   "Includes $X Gateway pending, which can still fail", and otherwise "Verified payments, self-pay excluded". Compute with bigint and format with formatUsdc. Chart title:
   "Verified revenue per <unit>, including Gateway pending".
3. src/screens/Billing.tsx: read planOf(address) in the chain resource and show it: "On-chain plan: Pro/Free" (0 = Free, 1 = Pro). If on-chain is Pro and /v1/me says free, show
   "Your payment is on-chain and the dashboard is catching up". In useUpgrade's sync step, use the same wording.
4. vercel.json: keep the rewrite and add headers for all paths: Content-Security-Policy: frame-ancestors 'none'; X-Frame-Options: DENY; X-Content-Type-Options: nosniff;
   Referrer-Policy: no-referrer. The meta CSP stays as is.
5. src/api/client.ts: every fetch gets signal: AbortSignal.timeout(20000); a timeout becomes ApiError('network_error', 'The ChainPe service did not answer in time.', 0).
6. src/screens/Reputation.tsx: badge "Never paid" becomes "No verified payment". The second card's label becomes "All ratings, including wallets with no verified payment: anyone can
   rate an agent". Keep "Paid you" and "From wallets that paid you".
7. Money format, using formatUsdc: Gateway balance in src/screens/Overview.tsx; service price in src/screens/Services.tsx; balance and allowance rows in src/screens/Billing.tsx. Keep formatUsdcExact only for
   price per period, total to pay, and the not-enough-USDC message, because the wallet charges those exact amounts.
8. src/auth/AuthContext.tsx: after restoring a stored live session, call eth_accounts once. If it returns a non-empty list whose first entry differs from the session address, clear the session with "Your wallet
   account changed, so you were signed out." An empty list (locked wallet) does nothing.
9. src/billing/useUpgrade.ts: set current = 'approve' right after the network step, so balance and read errors show on the approve step.
10. src/hooks/useResource.ts: on ApiError code plan_required, set the error and do not schedule another poll.
11. src/index.css: light --c-ok becomes 19 115 55 so ok on ok-soft passes 4.5:1.
12. src/components/ui/forms.tsx: Segmented becomes role="group" with aria-label and buttons using aria-pressed. Remove role="radio", aria-checked and radiogroup. Let it wrap (flex-wrap, no overflow-x-auto) so no option is clipped at 375 px.
13. src/main.tsx and src/components/AppShell.tsx: the "Built with Arc Studio" link stays but must not float over content. Move it into normal flow: at the end of the sidebar on desktop and at the end of <main> on
    mobile, and at the bottom of the sign-in page. Keep its text, link and rel. Export the component from a new file src/components/StudioMark.tsx.
14. vite.config.ts: add build.rollupOptions.output.manualChunks putting viem, ox, abitype and @noble into "web3", react and react-dom into "react". Keep the CSP plugin unchanged.

Finish with typecheck, the money tests and a production build passing. Report per item.
