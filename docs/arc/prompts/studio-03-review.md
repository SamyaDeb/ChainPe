Polish pass on the ChainPe provider dashboard. Dashboard only: do NOT touch contracts/, abi/, foundry.toml or remappings.txt. No contract build, audit or deploy
in this run; the contract is live and frozen for this phase. Do not change API calls, auth, session, money, explorer or billing logic, and do not add dependencies. Quick preset.

1. Mobile navigation: at 375 px the bottom tabs scroll sideways and hide Billing and Settings. Replace with five bottom items: Overview, Payments, Services, Reputation, More. More opens a simple
   panel listing Buyers, Listing health, Billing and Settings. It is keyboard reachable, closes on Escape and on navigation, has aria-expanded, and shows the active state when one of its pages is current.
   No inline style attributes (the production CSP forbids them).
2. Check every screen with mock data (VITE_USE_MOCK=true), as Pro, Free and Unregistered, at 375 px and 1280 px, light and dark. Fix layout overflow, clipped text, unreadable contrast (AA), and misaligned
   cards or tables. Copy "None. Run `chainpe identity`" in Services shows literal backticks: render the command in a code element.
3. Check that loading, error and empty states exist on every screen and read well. Check keyboard order and visible focus through the sign-in page, the nav and Billing.
4. Check amounts follow context/docs/arc/specs/07-provider-dashboard.md: 6 dp under $0.01, otherwise 2 dp. The exact formatter stays for price per period, total to pay and the not-enough-USDC message.
5. Finish with typecheck, the money tests and a production build passing. Report a short list of what you changed and what remains.
