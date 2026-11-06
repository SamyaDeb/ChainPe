# Demo video: 3-minute shot list

Plain lines to say are in quotes. Keep each shot short. Record at 1080p.

## Before you record

- [ ] Demo seller is up: open https://chainpe-arc-demo-production.up.railway.app/health
- [ ] chainpe-cloud is up: open https://chainpe-cloud-production.up.railway.app/health
- [ ] Dashboard is deployed and you can sign in as the seller and as the buyer
- [ ] Buyer wallet has test USDC (https://faucet.circle.com) and a Gateway balance (`chainpe deposit 0.05`)
- [ ] Browser: logged out of anything personal, no other tabs, zoom 125%
- [ ] Terminal: large font (18pt+), clean prompt, `alias chainpe=...` set, `.env` loaded but **never shown**
- [ ] Close every tab or editor that shows `.env`, keys or tokens
- [ ] Arc Studio workspace open and logged in
- [ ] Do one full dry run first; the demo seller sometimes needs a warm-up call

## Shots

| Time | Show on screen | Command or URL | Say |
|---|---|---|---|
| 0:00–0:20 | Title slide or the README top | `README.md` on GitHub | "AI agents want to pay for APIs. Most APIs only take API keys and monthly plans. ChainPe lets any API charge agents per call, in USDC, on Arc." |
| 0:20–0:45 | A plain API, then ChainPe in front of it | `chainpe start --network arc-testnet` | "This is a normal weather API. One command puts a price on it. The code of the API does not change." |
| 0:45–1:05 | The 402 answer | `curl -i "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Tokyo"` | "An unpaid request gets 402 Payment Required, with two ways to pay: a normal payment or a Circle Gateway nanopayment." |
| 1:05–1:30 | An agent pays, on both rails | `chainpe fetch ".../forecast?city=Tokyo" --rail exact --max 0.02` then `chainpe fetch ".../weather?city=London" --rail gateway --max 0.02` | "The agent signs a USDC payment. Circle settles it on Arc, and only then does the API answer." |
| 1:30–1:45 | The transaction on the explorer | the explorer link the CLI printed | "Here is that payment on Arc." |
| 1:45–2:15 | Dashboard: seller view, then the buyer on Free, then Upgrade | the dashboard URL | "Every developer who registers gets their own dashboard. Revenue is checked against Arc and Circle's records. Pro costs 19 USDC a month, paid on Arc. ChainPe charges 1% of verified revenue, or 0.5% on Pro, collected from USDC the developer approves." |
| 2:15–2:30 | `chainpe doctor` all green | `chainpe doctor` | "Doctor checks the service is ready for agents and for Circle's Agent Marketplace." |
| 2:30–2:50 | Arc Studio workspace: contract, tests, deployment, dashboard | the Studio workspace | "We built and deployed the accounts contract and the dashboard with Arc Studio." |
| 2:50–3:00 | README "Before and during" section | `README.md` | "ChainPe ran on Avalanche in June. This weekend we rebuilt it on Arc." |

## If something breaks while recording

- A Gateway payment shows `received`, not `completed`: that is normal. The batch lands in a few minutes.
- The seller is slow on the first call: make one warm-up call before you start recording.
