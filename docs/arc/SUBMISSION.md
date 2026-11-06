# Submission: Arc Studio Continuity Track

Prize: "Arc Studio Continuity Track: Bring Your Project to Arc" (ETHGlobal Mumbai, November 2026).

## Prize requirements

| Requirement | Status | Link |
|---|---|---|
| Built with Arc Studio | Done: contracts (runs 1, 1b) and dashboard (runs 2, 2b, 3) | [STUDIO-LOG.md](STUDIO-LOG.md) |
| Shareable Arc Studio project URL | **Check sharing**: the URL redirects to Circle login | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a |
| Working MVP, frontend and backend | Backend live; dashboard built, **not deployed yet** | [README live links](../../README.md#live-links) |
| Architecture diagram | Done | [README](../../README.md#how-it-works), [ARCHITECTURE.md](ARCHITECTURE.md) |
| Video demo and presentation | **You record it** | [DEMO-SCRIPT.md](DEMO-SCRIPT.md) |
| Documentation | Done | [docs/arc/README.md](README.md) |
| Public GitHub repo | Done (branch `arc`) | https://github.com/SamyaDeb/ChainPe |
| Before / during the hackathon | Done | [README section](../../README.md#before-and-during-the-hackathon) |

## Done

- [x] Contract `ChainPeAccounts` deployed with Arc Studio, source verified ([PROOF.md](PROOF.md))
- [x] Live paid calls on both payment options, verified by chainpe-cloud ([PROOF.md](PROOF.md))
- [x] `chainpe doctor` green with real paid calls (11 of 11)
- [x] Circle listing pack ready ([LISTING.md](LISTING.md))
- [x] README rewritten; old Avalanche README kept in `docs/avalanche/`
- [x] Website copy updated for Arc (apps/landing)

## Only you can do these

- [ ] Run the 10 Phase 8 paid calls in your terminal and add them to PROOF.md ([PAID-CALLS-RUNBOOK.md](PAID-CALLS-RUNBOOK.md))
- [ ] Send [TRY-IT.md](TRY-IT.md) to a friend; add their transaction to PROOF.md
- [ ] Deploy the dashboard; replace every `TODO(dashboard-url)` (README, this file)
- [ ] Make the Arc Studio workspace viewable by judges, or note how they get access
- [ ] Submit the Circle form ([LISTING.md](LISTING.md)); then say "submitted" in the README
- [ ] Build the landing site (`cd apps/landing && npm install && npm run build`) and redeploy chainpe.vercel.app
- [ ] Merge `arc` into `main` (or set `arc` as the default branch) so judges see the new README first
- [ ] Update the commit count in the README just before you submit
- [ ] Record the video ([DEMO-SCRIPT.md](DEMO-SCRIPT.md))
- [ ] Submit on ETHGlobal and name the prize

## 30-second pitch

"AI agents want to pay for APIs, but most APIs only take API keys and monthly plans.
ChainPe puts a price on any API with one command. Agents pay per call in USDC on Arc, and Circle settles each payment before the API answers.
Every developer gets a dashboard that shows revenue checked against Arc and Circle's records.
The tool is free. We charge 1% of verified revenue, or 0.5% on the Pro dashboard, collected from USDC the developer approves.
ChainPe ran on Avalanche in June. This weekend we rebuilt it on Arc with Arc Studio."

## Likely judge questions

| Question | Answer |
|---|---|
| Who is the user? | Developers who sell API calls, MCP tools or agents. Not shops. |
| Why not just follow Circle's seller guide? | No code changes, any language, both payment options, listing checks, ratings and a dashboard. |
| How do you make money? | A usage fee of 1% of verified revenue, 0.5% on the Pro dashboard, which is paid in USDC on Arc. Buyers still pay the developer's wallet directly. |
| What did you build this weekend? | The README "During" table, the Studio log, and 79 commits after the June tag. |
| What about shops and merchants? | Card networks will bring agent shoppers to shops. Agents already pay developers per call in USDC. |
