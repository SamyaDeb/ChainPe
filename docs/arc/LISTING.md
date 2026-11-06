# Circle Agent Marketplace: submission pack

Status: **not submitted yet.** You submit the form yourself.
Form: https://forms.gle/7YFzvdmMcn1JH5tF6

## Before you submit

1. Run `chainpe doctor` against the live seller and make sure every required check is green.
   (Last green run: 2026-11-06, 11 of 11 with `--pay`. This session could not rerun it, because the
   shell here has no network access. Run it yourself first.)
2. Open https://chainpe-arc-demo-production.up.railway.app/forecast?city=Tokyo in a browser.
   You should get a `402 Payment Required` answer. That proves the paywall is live.

## Copy-paste values

| Form field | Paste this |
|---|---|
| Endpoint URL | `https://chainpe-arc-demo-production.up.railway.app` |
| Payout wallet | `0x261f058496D81703c858DDFEd201834F0b5f2e73` |
| Short description | `Current weather and 5-day forecasts for any city, as clean JSON your agent can parse. No API key or signup: pay per call in USDC on Arc over x402, from $0.001 per request.` |
| OpenAPI URL | `https://chainpe-arc-demo-production.up.railway.app/openapi.json` |
| Network | Arc testnet (`eip155:5042002`) |
| Payment options | Normal x402 payment (`/forecast`, $0.01) and Circle Gateway nanopayments (`/weather`, $0.001; `/forecast`, $0.01) |
| Category (if asked) | `DATA_ENRICHMENT` |

The form may ask for more than this. Circle's page only names three things: "your endpoint URL,
payout wallet address, and a short description." Fill anything else from the table above.

## What Circle's page says (checked 2026-11-06)

Source: https://developers.circle.com/agent-stack/agent-marketplace/get-listed.md

| Question | Answer |
|---|---|
| Is testnet accepted? | The page does not say. In practice, yes: Circle's Discovery API lists **134 services on Arc testnet** today (checked live: `GET /v2/x402/discovery/resources?network=eip155:5042002`). |
| Required fields | Only these are named: "your endpoint URL, payout wallet address, and a short description." |
| Prerequisites | The service must return "`402 Payment Required` when a request is unpaid and serves the resource when paid", and you must have "published an OpenAPI spec for your service". Both are true for our seller. |
| Category list | Not published on the page. The live Discovery API uses these six values: `COMMUNICATION`, `DATA_ENRICHMENT`, `FINANCIAL_ANALYSIS`, `INFRASTRUCTURE`, `TRAVEL_SHOPPING`, `WEB_SEARCH_RESEARCH`. Ours, `DATA_ENRICHMENT`, is one of them. |
| Review | "Listings are reviewed and approved manually today." "The team screens and approves your submission." No timeline is given. |
| Sanctions check | "Your seller payout wallet is sanctions-screened as part of review." |
| After listing | "It is then continuously health-checked, so it stays listed only while it is reachable." |

## After you submit

1. Keep the demo seller running on Railway. If it goes down, it can be removed from the listing.
2. Check once a day whether it is listed:
   `https://api.circle.com/v2/x402/discovery/resources?payTo=0x261f058496D81703c858DDFEd201834F0b5f2e73`
   (Today it returns 0 results, as expected before review.)
3. When it appears, add a row to `docs/arc/PROOF.md` and change "submitted" to "listed" in the README.
   Until then, always say "submitted", never "listed".
