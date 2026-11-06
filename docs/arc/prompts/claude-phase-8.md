You are a senior x402 / EVM payments engineer and a clear technical writer, finishing the ChainPe → Arc
port for the ETHGlobal Mumbai "Arc Studio Continuity Track". Phase 8 = proof and submission material.
I will record the demo video myself and submit forms myself. Your job is to make everything ready.

HARD RULE — NO GIT WRITES. Do not run git commit, git add, git push, git tag, git stash, git reset,
git checkout of files, or anything that changes git history or the index. Leave every change in the
working tree. At the end, print `git status --short` and a suggested list of commit messages
(prefix `arc:`) that I can run myself.

Read first: CLAUDE.md, docs/arc/README.md, PRD.md, BUSINESS-MODEL.md, ARCHITECTURE.md, SUBMISSION.md,
PROOF.md, STUDIO-LOG.md, LISTING.md, BUILD-PLAN.md (Phase 8), docs/arc/reviews/*, the root README.md,
examples/arc-demo/*, apps/landing/**, apps/dashboard/src/**, apps/arc-dashboard/README.md.
Check `git log --oneline avalanche-june-2026..HEAD` (if the tag is missing, use the first commit dated
2026-11-06) to know exactly what was built during the hackathon. Never invent a feature, number or link:
everything you write must be traceable to the code, PROOF.md or a live check you ran.

Live services (check each is up first; report any that is down and continue with the rest)
- Demo seller: https://chainpe-arc-demo-production.up.railway.app
- chainpe-cloud API: https://chainpe-cloud-production.up.railway.app
- Arc Studio workspace: https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a
- ChainPeAccounts (Arc testnet, verified): 0xD315322c9D83A6f50A04236A2a242e0259bfB580
- Provider dashboard: read its URL from PROOF.md / STUDIO-LOG.md / apps/arc-dashboard. If it is not
  deployed yet, write TODO(dashboard-url) placeholders and list them at the end.

TASK 1 — Real paid calls on the live demo seller
1. Run `chainpe doctor` against the live seller (plain, then --pay). Paste the summary.
2. From the buyer wallet (.env CHAINPE_PRIVATE_KEY), run 10 paid calls with `chainpe fetch`:
   5 × GET /weather?city=<different cities> on Gateway (--rail gateway),
   5 × GET /forecast?city=<different cities> on exact (--rail exact). Use --max 0.02.
   Record each: time (IST), route, rail, amount, tx hash or Gateway transfer id, explorer link.
3. Second-person payment: write docs/arc/TRY-IT.md — a short guide a friend can follow in 5 minutes to
   pay the demo once from their own wallet (get Arc testnet USDC at https://faucet.circle.com, install the
   CLI from this repo, run one `chainpe fetch`). I will send it to someone; do not use any of my keys for it.
4. Check the calls show up and turn `verified` in chainpe-cloud (use `chainpe login` session or the
   dashboard). Note how long each rail took to verify.
5. Append all of it to docs/arc/PROOF.md in the existing table style, newest at the bottom, plus a short
   "Totals" line (calls, USDC earned by rail, verified count). Do not change older rows.

TASK 2 — Circle Agent Marketplace submission pack (I submit the form myself)
1. Rerun `chainpe doctor`; refresh docs/arc/LISTING.md with the current field values.
2. Re-read Circle's "Get listed" page (https://developers.circle.com/agent-stack/agent-marketplace/get-listed.md)
   and answer in LISTING.md, quoting the page: are testnet services accepted, which fields are required,
   is a category list published (if so, check ours), what review and health checks happen.
3. Add a ready-to-paste block for every form field, and a 3-line "after submitting" checklist
   (keep the seller up, how to check the Discovery API for the listing:
   GET https://api.circle.com/v2/x402/discovery/resources?payTo=<wallet>).

TASK 3 — Fix the website copy (apps/landing is the public site at chainpe.vercel.app; also apps/dashboard
marketing page). Make it true and current for Arc. Change copy and links only, not the design.
- Replace Avalanche positioning with Arc: payments in USDC on Arc, settled by Circle; Gateway nanopayments.
- Remove wrong or unprovable claims: "pay in native AVAX", the placeholder testimonial ("SDK User"),
  "0.99% uptime", the static "All operational" status board, "36 audit findings fixed" (replace with a link
  to docs/arc/reviews/ only if the claim is true there; otherwise remove), Avalanche fee/finality numbers.
- Every GitHub link → https://github.com/SamyaDeb/ChainPeAvax. Docs links that point to chainpe.xyz →
  the repo's docs/arc/README.md (unless chainpe.xyz is live and correct — check it).
- Pricing section = the real model: CLI/SDK free and open source; provider dashboard Free and Pro
  (Pro = 19 USDC / 30 days on mainnet, 1 USDC on testnet), paid on Arc; no cut of payments.
- Add links: live demo seller, provider dashboard, Arc Studio workspace, PROOF.md.
- Fix the root CHANGELOG (docs/CHANGELOG.md): the "1.0.0 - 2024-07" entry has a wrong date — use the real
  date from git history or remove the date; add an "Arc (ETHGlobal Mumbai, Nov 2026)" entry.
- Run the landing build (npm run build in apps/landing) and fix anything you broke. List every changed
  string in a before → after table in your report.

TASK 4 — Rewrite the root README.md (most important)
Audience: a hackathon judge who has 2 minutes, then a developer who wants to try it.
Style rules: plain, easy English. Short sentences (aim under 20 words). One idea per paragraph.
Explain every term once in brackets the first time (x402, Gateway, ERC-8004, Arc Studio). No marketing
words ("revolutionary", "seamless", "cutting-edge"), no emoji walls, no badge clutter (at most 3 badges).
Use tables and short lists, not long paragraphs. Every claim links to proof (PROOF.md row, explorer, code).

Structure (keep this order and these headings):
1. **ChainPe** — one line: "Turn any API into a paid service for AI agents on Arc, in one command."
   Then 3 short sentences: the problem, what ChainPe does, who it is for (developers, not merchants).
2. **Live links** — table: demo seller, provider dashboard, Arc Studio workspace, ChainPeAccounts
   contract on the explorer, proof of live payments (PROOF.md).
3. **How it works** — 4 numbered steps (agent finds the API → pays → Circle settles on Arc → the API
   answers), then the simple mermaid diagram from docs/arc/ARCHITECTURE.md §1 (simplify if needed).
   One short paragraph on the two payment options: normal payments and Gateway nanopayments.
4. **Try it in 5 minutes** — for a provider: install, init, start, doctor (real commands from the CLI);
   for a buyer: one `chainpe fetch` against the live demo. Link TRY-IT.md.
5. **Before and during the hackathon** — the section judges read. Two clear parts:
   - "Before (June 2026, on Avalanche)": what existed, link the avalanche-june-2026 tag and the June
     mainnet transactions from the old README (keep them, they prove continuity).
   - "During ETHGlobal Mumbai (November 2026, on Arc)": a table — what we built | why it matters |
     proof link. Include: move to x402 v2 and Arc; settlement through Circle's facilitator; Gateway
     nanopayments; ChainPeAccounts contract built and deployed with Arc Studio; security review and fix;
     ERC-8004 identity on Arc's registry; `chainpe doctor`; chainpe-cloud with verified revenue; provider
     dashboard built with Arc Studio. Add "Commits during the hackathon: N" from git.
6. **Business model** — 4 lines: free CLI, Free/Pro dashboard paid in USDC on Arc, no cut of payments
   and why (seller-signed settlement), link BUSINESS-MODEL.md.
7. **Built with Circle and Arc** — table: product | how ChainPe uses it (Arc, Arc Studio, Facilitator
   Service, Gateway, Discovery API / Agent Marketplace, ERC-8004 registries, USDC).
8. **Security and honest limits** — short list from the specs' "Known limitations" and reviews
   (e.g. Gateway is served once Circle accepts the payment; buyer is charged if the API fails after
   payment; testnet only; marketplace listing pending review). Link the review files.
9. **Repo map** — small table of the folders that matter now.
10. **Docs** — link docs/arc/README.md and the specs index. **License** — MIT.
Move the old Avalanche README content to docs/avalanche/README.md unchanged (with one line at the top
saying it describes the June 2026 Avalanche version) and link it from section 5.
Also write docs/arc/README-CHECK.md: every link in the new README with its HTTP status from a live check,
and every number with the PROOF.md row it comes from.

TASK 5 — Demo recording kit (I record it myself)
Write docs/arc/DEMO-SCRIPT.md: a 3-minute shot list with time stamps, what to show on screen, the exact
command or URL for each shot, and one or two plain-English lines I can say. Order: problem → one-command
start in front of a plain API → 402 with two payment options → agent pays (both rails) → explorer tx →
dashboard (seller view, Free buyer view, upgrade) → `chainpe doctor` → Arc Studio workspace (contracts,
tests, deployments, dashboard) → before/after and business model. Add a pre-recording checklist (services
up, wallets funded, browser logged out, terminal font size, close secrets/.env tabs, testnet faucet done).

TASK 6 — Submission checklist
Update docs/arc/SUBMISSION.md: tick what is done with links, list what only I can do (record video,
submit ETHGlobal form, submit Circle form, send TRY-IT.md to a friend), and paste the final 30-second pitch
rewritten in the same plain style as the README.

Rules
- No git writes (see top). No contract deploys. No changes to packages/, services/ or contracts-arc/
  logic — this phase is docs, website copy, and live paid calls only. If you find a real bug, stop and
  report it instead of fixing it.
- Never print or write private keys, session tokens or ingest keys into any file.
- Keep claims honest: if something is not proven live, say "tested in unit tests only" or leave it out.

Report at the end: services status, the paid-call table, verification timings, LISTING.md answers,
website before → after table, README outline with word count, README-CHECK.md summary (any broken
links), files changed, `git status --short`, and the suggested commit messages.
