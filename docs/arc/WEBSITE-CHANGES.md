# Website copy changes (Phase 8)

Every text or link changed in `apps/landing`. Design untouched. The testimonials section was removed from `app/page.tsx` (all four quotes were invented); its file is kept.

| File | Before | After |
|---|---|---|
| `hero-section.tsx` | x402 payment infrastructure for Avalanche | x402 payments for AI agents, on Arc |
| `hero-section.tsx` | Pay any API in USDC, rate any agent on‑chain, | Turn any API into a paid service for AI agents. |
| `hero-section.tsx` | settle on Avalanche in ~1–2 seconds. All in 3 lines of code. | One command. USDC on Arc. Settled by Circle. |
| `hero-section.tsx` | { value: "~1–2s", label: "settlement finality", company: "AVALANCHE" } | { value: "<1s", label: "finality on Arc", company: "ARC" } |
| `hero-section.tsx` | { value: "$0.0003", label: "cost per transaction", company: "C-CHAIN" } | { value: "2", label: "payment options", company: "X402 + GATEWAY" } |
| `hero-section.tsx` | { value: "44", label: "contract tests passing", company: "HARDHAT" } | { value: "101", label: "contract tests passing", company: "FOUNDRY" } |
| `hero-section.tsx` | { value: "3 lines", label: "to integrate payments", company: "SDK" } | { value: "1 command", label: "to start selling", company: "CLI" } |
| `hero-section.tsx` | window.location.href = '/docs' | window.location.href = 'https://github.com/SamyaDeb/ChainPeAvax/tree/arc/docs/arc' |
| `features-section.tsx` | "Any HTTP endpoint returns 402 Payment Required with a USDC price. Consumers auto-pay with a signed EIP-3009 t | "Any HTTP endpoint answers 402 Payment Required with a USDC price. The buyer signs a payment, and Circle's fac |
| `features-section.tsx` | "Every paid call lets the payer rate the service 1–5 ⭐. Scores are portable, permissionless, and self-feedback | "Each service gets an identity on Arc's ERC-8004 registry. Payers rate it after a call, and your dashboard sho |
| `features-section.tsx` | title: "Gasless Policy Spending" | title: "Gateway Nanopayments" |
| `features-section.tsx` | "PolicyVault lets owners set on-chain limits — maxPerCall, dailyCap, totalBudget, expiry, allowlist — and gran | "Buyers can pay from a Circle Gateway balance, with no gas and prices below one cent. Circle settles these pay |
| `features-section.tsx` | title: "Cross-L1 Hiring via ICM" | title: "Your Own Dashboard" |
| `features-section.tsx` | "An agent on one Avalanche L1 can hire a service on another via Teleporter — no bridges, no wrapped tokens. Tr | "Register once and sign in with your wallet. See your revenue, buyers and ratings, each checked against Arc an |
| `features-section.tsx` | All on Avalanche. | All on Arc. |
| `how-it-works-section.tsx` | description: "Monetize any HTTP endpoint with one command. The proxy returns 402 Payment Required with a USDC  | description: "Put the ChainPe proxy in front of any HTTP API. It answers unpaid requests with 402 Payment Requ |
| `how-it-works-section.tsx` | code: `import { ChainPe } from '@chainpeavax/sdk'  const cp = new ChainPe({   privateKey: process.env.KEY!,    | code: `chainpe init chainpe start --network arc-testnet  # unpaid request -> 402 Payment Required`, |
| `how-it-works-section.tsx` | title: "Agent pays & uses" | title: "Agent pays, API answers" |
| `how-it-works-section.tsx` | description: "cp.fetch is a drop-in fetch — on 402 it signs a USDC payment (EIP-3009), retries, and returns th | description: "The agent signs a USDC payment. Circle settles it on Arc, and only then does the proxy call your |
| `how-it-works-section.tsx` | code: `const res = await cp.fetch(   'https://api.example.com/paid' ) // auto-pays 402 in USDC const data = aw | code: `chainpe fetch \\   "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Tokyo" \\   --rail |
| `how-it-works-section.tsx` | title: "Discover & rate" | title: "Get found, get rated" |
| `how-it-works-section.tsx` | description: "Agents discover ⭐-ranked services from the on-chain registry and rate them after each call. Repu | description: "Give your service an ERC-8004 identity, register it, and check it is ready for Circle's Agent Ma |
| `how-it-works-section.tsx` | code: `const services = await cp.discover() // returns ⭐-ranked services  await cp.giveFeedback(agentId, 5) // | code: `chainpe identity   # ERC-8004 on Arc chainpe register   # provider account chainpe doctor     # ready f |
| `how-it-works-section.tsx` | >chainpe.ts< | >terminal< |
| `how-it-works-section.tsx` | Ready — Avalanche Mainnet | Ready — Arc testnet |
| `infrastructure-section.tsx` | { city: "Avalanche C-Chain", region: "Primary Settlement", latency: "~1.2s" } | { city: "Arc testnet", region: "Settlement network", latency: "chain 5042002" } |
| `infrastructure-section.tsx` | { city: "Mainnet", region: "Development", latency: "~1.5s" } | { city: "Circle Facilitator", region: "Normal x402 payments", latency: "settles on Arc" } |
| `infrastructure-section.tsx` | { city: "ICM Subnet A", region: "Cross-L1", latency: "~2.1s" } | { city: "Circle Gateway", region: "Nanopayments", latency: "batched" } |
| `infrastructure-section.tsx` | { city: "ICM Subnet B", region: "Cross-L1", latency: "~2.3s" } | { city: "ChainPeAccounts", region: "Provider accounts", latency: "verified source" } |
| `infrastructure-section.tsx` | { city: "Railway (Facilitator)", region: "Settlement Service", latency: "<100ms" } | { city: "Demo seller", region: "Live paid API", latency: "Railway" } |
| `infrastructure-section.tsx` | { city: "Railway (Indexer)", region: "Discovery API", latency: "<50ms" } | { city: "chainpe-cloud", region: "Verified revenue API", latency: "Railway" } |
| `infrastructure-section.tsx` | Avalanche-native | Arc-native |
| `infrastructure-section.tsx` | Sub-cent settlement, ~1–2s deterministic finality, and native Circle USDC | Sub-second finality, gas paid in USDC, and settlement by Circle |
| `infrastructure-section.tsx` | make pay-per-request economics real. Plus cross-L1 hiring over ICM/Teleporter. | make pay-per-request pricing practical. Plus Gateway nanopayments for prices below one cent. |
| `infrastructure-section.tsx` | <div className="text-4xl lg:text-5xl font-display mb-2">$0.003</div> | <div className="text-4xl lg:text-5xl font-display mb-2">USDC</div> |
| `infrastructure-section.tsx` | <div className="text-sm text-muted-foreground">Per settlement</div> | <div className="text-sm text-muted-foreground">Gas token</div> |
| `infrastructure-section.tsx` | <div className="text-4xl lg:text-5xl font-display mb-2">~1–2s</div> | <div className="text-4xl lg:text-5xl font-display mb-2">&lt;1s</div> |
| `infrastructure-section.tsx` | <div className="text-4xl lg:text-5xl font-display mb-2">44</div> | <div className="text-4xl lg:text-5xl font-display mb-2">101</div> |
| `infrastructure-section.tsx` | >Network Status< | >What runs where< |
| `infrastructure-section.tsx` | All operational | Arc testnet |
| `metrics-section.tsx` | value: 44,      suffix: "",      prefix: "",     label: "Contract tests passing", | value: 101,      suffix: "",      prefix: "",     label: "Contract tests (Foundry)", |
| `metrics-section.tsx` | value: 99,      suffix: ".99%",      prefix: "",     label: "Uptime on mainnet", | value: 233,      suffix: "",      prefix: "",     label: "CLI and proxy tests", |
| `metrics-section.tsx` | value: 3,      suffix: "",      prefix: "",     label: "Lines to integrate payments", | value: 135,      suffix: "",      prefix: "",     label: "Cloud API tests", |
| `metrics-section.tsx` | value: 8,      suffix: "",      prefix: "",     label: "Surfaces powered by one core", | value: 1,      suffix: "",      prefix: "",     label: "Command to start selling", |
| `metrics-section.tsx` | Live metrics | By the numbers |
| `metrics-section.tsx` | Live on Mainnet | Live on Arc testnet |
| `integrations-section.tsx` | { name: "Vercel AI SDK", category: "AI Framework" } | { name: "Arc", category: "Blockchain" } |
| `integrations-section.tsx` | { name: "LangChain", category: "AI Framework" } | { name: "Arc Studio", category: "Build" } |
| `integrations-section.tsx` | { name: "Claude MCP", category: "AI Assistant" } | { name: "Circle Facilitator", category: "Settlement" } |
| `integrations-section.tsx` | { name: "Avalanche C-Chain", category: "Blockchain" } | { name: "Circle Gateway", category: "Nanopayments" } |
| `integrations-section.tsx` | { name: "ICM/Teleporter", category: "Cross-L1" } | { name: "Agent Marketplace", category: "Discovery" } |
| `integrations-section.tsx` | { name: "Hardhat", category: "Development" } | { name: "Foundry", category: "Development" } |
| `integrations-section.tsx` | { name: "EIP-3009", category: "Payment Standard" } | { name: "x402 v2", category: "Payment Standard" } |
| `integrations-section.tsx` | Drop-in tools for Vercel AI SDK, LangChain, Claude MCP, and any HTTP client. | Built on Circle's stack for Arc. Works with any HTTP API, in any language. |
| `security-section.tsx` | description: "The facilitator never holds funds. Payers sign EIP-3009 authorizations; the facilitator submits  | description: "Buyers pay your wallet directly. Circle's facilitator settles the signed USDC payment and pays t |
| `security-section.tsx` | title: "On-chain Spending Caps" | title: "Paid Before Served" |
| `security-section.tsx` | description: "PolicyVault enforces maxPerCall, dailyCap, totalBudget, and expiry limits on-chain. Overspends r | description: "The proxy settles every payment before it calls your API. Pending or failed payments never reach |
| `security-section.tsx` | description: "ERC-8004 blocks self-rating on-chain. Reputation only accrues from real counterparties." | description: "ERC-8004 on Arc blocks self-rating. Your dashboard separates ratings from wallets that actually  |
| `security-section.tsx` | title: "36 Audit Findings Fixed" | title: "Reviewed Contract" |
| `security-section.tsx` | description: "Full security audit completed — 3 Critical, 12 High, 11 Medium, 10 Low. All resolved and verifie | description: "ChainPeAccounts was reviewed before launch: no High findings, one Medium found and fixed, 101 Fo |
| `security-section.tsx` | const certifications = ["EIP-3009", "ERC-8004", "EIP-712", "UUPS", "OpenZeppelin"]; | const certifications = ["x402 v2", "EIP-3009", "ERC-8004", "EIP-712", "OpenZeppelin"]; |
| `security-section.tsx` | Non-custodial by design. On-chain spending caps. Self-feedback-resistant reputation. | Non-custodial by design. Settled before your API runs. Reviewed contracts. |
| `pricing-section.tsx` | name: "Mainnet",     description: "For development and testing",     price: "Free",     period: "forever",     | name: "Open source",     description: "CLI, proxy and SDK",     price: "Free",     period: "forever",     feat |
| `pricing-section.tsx` | name: "Production",     description: "Pay-as-you-go on mainnet",     price: "$0.003",     period: "per settlem | name: "Dashboard Pro",     description: "Paid in USDC on Arc",     price: "19 USDC",     period: "per 30 days" |
| `pricing-section.tsx` | name: "Self-Hosted",     description: "Run your own infrastructure",     price: "Open",     period: "source",  | name: "Dashboard Free",     description: "For every registered provider",     price: "Free",     period: "fore |
| `pricing-section.tsx` | Pay per request. | Keep 100% of |
| `pricing-section.tsx` | <span className="text-stroke">No subscriptions.</span> | <span className="text-stroke">what agents pay.</span> |
| `pricing-section.tsx` | A sustainable model for the agent economy. Only pay when your agents successfully transact. | ChainPe takes no cut. Buyers pay your wallet directly. You only pay if you want the Pro dashboard (1 USDC on t |
| `pricing-section.tsx` | Mainnet Default | Pro |
| `pricing-section.tsx` | Note: Network gas fees on Avalanche C-Chain still apply.{" "} | Note: on Arc, gas is paid in USDC. Circle's facilitator pays settlement gas; Gateway withdrawals carry a small |
| `pricing-section.tsx` | <a href="#" className="underline underline-offset-4 hover:text-foreground transition-colors">             Read | <a href="https://github.com/SamyaDeb/ChainPeAvax/blob/arc/docs/arc/BUSINESS-MODEL.md" className="underline und |
| `cta-section.tsx` | Join the Avalanche agent economy. One SDK, three lines of code, sub-cent settlement. | Put a price on your API today. One command, USDC on Arc, and no cut taken. |
| `cta-section.tsx` | npm install @chainpeavax/sdk | git clone github.com/SamyaDeb/ChainPeAvax |
| `developers-section.tsx` | code: `npm install @chainpeavax/sdk  # or yarn add @chainpeavax/sdk pnpm add @chainpeavax/sdk`, | code: `git clone https://github.com/SamyaDeb/ChainPeAvax cd ChainPeAvax && git checkout arc npm install && npm |
| `developers-section.tsx` | label: "Pay", | label: "Sell", |
| `developers-section.tsx` | code: `import { ChainPe } from '@chainpeavax/sdk'  const cp = new ChainPe({   privateKey: process.env.KEY!,    | code: `chainpe init chainpe start --network arc-testnet chainpe identity chainpe register chainpe doctor`, |
| `developers-section.tsx` | label: "Discover", | label: "Buy", |
| `developers-section.tsx` | code: `// Find services ranked by reputation const services = await cp.discover()  // Rate after using await c | code: `# pay a live API on Arc testnet chainpe fetch \\   "https://chainpe-arc-demo-production.up.railway.app/ |
| `developers-section.tsx` | title: "Drop-in fetch" | title: "Paid fetch" |
| `developers-section.tsx` | description: "cp.fetch works like native fetch with auto-pay." | description: "chainpe fetch pays any 402 in USDC, never above your --max." |
| `developers-section.tsx` | title: "AI framework tools" | title: "Two payment options" |
| `developers-section.tsx` | description: "Vercel AI SDK + LangChain integrations." | description: "Normal x402 payments and Circle Gateway nanopayments." |
| `developers-section.tsx` | title: "Published on npm" | title: "Open source" |
| `developers-section.tsx` | description: "@chainpeavax/sdk, ai-tools, cli." | description: "MIT licensed. The Arc version lives on the arc branch." |
| `developers-section.tsx` | A thoughtfully designed SDK that gets out of your way. | A small CLI that gets out of your way. |
| `developers-section.tsx` | Three lines to payments. Published on npm. Works with any HTTP client. | One command to start selling. Works with any HTTP API, in any language. |
| `developers-section.tsx` | href="https://chainpe.xyz/docs" | href="https://github.com/SamyaDeb/ChainPeAvax/tree/arc/docs/arc" |
| `developers-section.tsx` | href="https://github.com/SamyaDeb/ChainPe" | href="https://github.com/SamyaDeb/ChainPeAvax" |
| `footer-section.tsx` | { name: "Documentation", href: "https://chainpe.xyz/docs" } | { name: "Documentation", href: "https://github.com/SamyaDeb/ChainPeAvax/tree/arc/docs/arc" } |
| `footer-section.tsx` | { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPe" },     { name: "SDK Packages" | { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPeAvax" },     { name: "SDK Packages" |
| `footer-section.tsx` | { name: "SDK Packages", href: "https://www.npmjs.com/org/chainpeavax" } | { name: "Live demo", href: "https://chainpe-arc-demo-production.up.railway.app" } |
| `footer-section.tsx` | { name: "Mainnet", href: "#" } | { name: "Proof of payments", href: "https://github.com/SamyaDeb/ChainPeAvax/blob/arc/docs/arc/PROOF.md" } |
| `footer-section.tsx` | { name: "Avalanche C-Chain", href: "#" } | { name: "Arc", href: "https://www.arc.io" } |
| `footer-section.tsx` | { name: "Circle USDC", href: "#" } | { name: "Circle USDC", href: "https://www.circle.com/usdc" } |
| `footer-section.tsx` | { name: "Teleporter", href: "#" } | { name: "Arc Studio", href: "https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a" } |
| `footer-section.tsx` | { name: "Vercel AI SDK", href: "#" } | { name: "Circle Gateway", href: "https://developers.circle.com/gateway" } |
| `footer-section.tsx` | { name: "Smart Contract Audit", href: "#security" } | { name: "Contract review", href: "https://github.com/SamyaDeb/ChainPeAvax/blob/arc/docs/arc/reviews/chainpe-ac |
| `footer-section.tsx` | { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPe" },   { name: "Discord" | { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPeAvax" },   { name: "Discord" |
| `footer-section.tsx` | Payment and reputation infrastructure for the Avalanche agent economy. | Payments and reputation for AI agents on Arc. |
| `footer-section.tsx` | 2025 ChainPe. Built for the Avalanche ecosystem. | 2026 ChainPe. Built on Arc. |
| `navigation.tsx` | <a href="/docs" className | <a href="https://github.com/SamyaDeb/ChainPeAvax/tree/arc/docs/arc" className |
| `navigation.tsx` | window.location.href = '/docs'; | window.location.href = 'https://github.com/SamyaDeb/ChainPeAvax/tree/arc/docs/arc'; |
| `layout.tsx` | title: 'ChainPe — Pay any API, rate any agent, all on Avalanche' | title: 'ChainPe — Turn any API into a paid service for AI agents on Arc' |
| `layout.tsx` | description: 'x402 payment + reputation infrastructure for the Avalanche agent economy. Monetize any HTTP API  | description: 'Put a USDC price on any HTTP API with one command. AI agents pay over x402 on Arc, Circle settle |
| `layout.tsx` | githubUrl="https://github.com/SamyaDeb/ChainPe" | githubUrl="https://github.com/SamyaDeb/ChainPeAvax" |
| `page.tsx` | import { TestimonialsSection } from "@/components/landing/testimonials-section"; |  |
| `page.tsx` | <TestimonialsSection /> |  |

Also in `apps/dashboard` (the legacy June marketing page): "native AVAX" payment claims → USDC (6 strings). In `docs/CHANGELOG.md`: the wrong `1.0.0 - 2024-07` date → `2026-06-13`, plus a new Arc entry.
