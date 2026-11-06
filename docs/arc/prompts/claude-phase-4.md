You are a senior x402 / EVM payments engineer continuing the ChainPe → Arc port. Phase 3 is done and was
independently re-verified. Phase 4 = `chainpe identity`, `register`, `deregister`, `list`, `plan`, `upgrade` and
`doctor` on Arc. These commands sign real transactions, spend the seller's USDC and publish strings on-chain
permanently, so correctness beats speed: never mint a duplicate identity, never publish the private backend URL,
never report an RPC failure as "not registered".

Read first: CLAUDE.md, docs/arc/BUILD-PLAN.md (Phase 4), docs/arc/specs/06-provider-accounts.md,
10-erc8004-identity.md, 05-chainpe-doctor.md, docs/arc/reviews/chainpe-accounts-review.md (L-1, L-2, L-3, L-6),
contracts-arc/contracts/ChainPeAccounts.sol, and in packages/chainpe/src: cli.ts, chains.ts, erc8004.ts, registry.ts,
types.ts, commands/seller.ts, proxy/server.ts, proxy/routeConfig.ts, proxy/circleFacilitator.ts. Also
__tests__/proxy.test.ts. Use the arc-docs MCP for Arc facts, and read these before building doctor:
https://developers.circle.com/agent-stack/agent-marketplace/become-a-seller.md and
https://developers.circle.com/agent-stack/agent-marketplace/discovery-api.md. Read installed SDK types in
node_modules/@x402/core rather than guessing APIs (`decodePaymentRequiredHeader` exists in @x402/core/http).

State (verified 2026-11-06, re-check anything you depend on)
- Branch `arc`, CLI 3.0.0-arc.0. 126 CLI tests pass, tsc clean. 101 Foundry tests pass, 100% contract coverage.
- ChainPeAccounts, Arc testnet: 0xD315322c9D83A6f50A04236A2a242e0259bfB580. Owner and treasury
  0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a. Pro = 1 USDC per 30 days. Source verified. Runtime bytecode matches a
  local compile once immutables are filled. Studio workspace and contracts-arc match. ABI in src/abi matches.
- Live state you inherit from the smoke test. It changes the design:
  - Seller 0x261f058496D81703c858DDFEd201834F0b5f2e73 ALREADY has a provider with agentId 0, Pro until 2026-12-05,
    and holds no ERC-8004 token. So `registerProvider` would revert: linking needs `setAgentId`.
  - `demo-weather` is active with endpoint https://example.com/weather; `demo-weather-2` is inactive.
  - Buyer 0x24BC730c658201bC51873f7aeAaDE65A545c7A11 is also a provider (Free, `buyer-demo` active on example.com).
    Phases 5 and 6 "other wallet sees nothing" tests must use a THIRD wallet. Record that in BUILD-PLAN.
- Config trap: the default ~/.chainpe/config.json is an UNRELATED service (network arbitrum-sepolia, another wallet,
  agentId 273). Do not edit or use it. Use CHAINPE_CONFIG=~/.chainpe/arc-testnet.json for all live runs. That config
  is "ChainPe Weather Demo", targetUrl http://localhost:3001, $0.01, no routes, no agentId, and a 39-character
  description. Do not read ~/.chainpe/wallet.json or print .env values.

ERC-8004 facts already checked against the live proxy (implementation 0x7274e874…9c02, verified):
- Our contracts/abis/erc8004/IdentityRegistry.json matches; live only adds `isAuthorizedOrOwner`. This closes the spec
  10 VERIFY for Identity only (Reputation is Phase 7's).
- `register` has 3 overloads: keep a minimal ABI with `register(string)` only. Also available: `ownerOf`, `tokenURI`,
  `setAgentURI(uint256,string)`, `balanceOf`. `Registered(agentId indexed, agentURI, owner indexed)` matches erc8004.ts.
- NOT ERC721Enumerable, so no wallet→tokenId read. `eth_getLogs` on the public RPC rejects 10,000 blocks ("requested
  range too large"; 5,000 works and larger spans can rate-limit), and the registry is ~40M blocks old, so log scans
  are impractical. Recovery works through the explorer: GET
  https://explorer.testnet.arc.io/api/v2/addresses/{addr}/nft?type=ERC-721, filter by registry, confirm with `ownerOf`.
- `ownerOf` on an absent token reverts with ERC721NonexistentToken, which is not in our ABI. Add it so it decodes.

PART A — carry-overs (one small `arc:` commit each; do these first)
A1. Git safety. Local `arc` has 27+ commits and NO upstream, origin has only `main`, and the tag
    `avalanche-june-2026` does not exist anywhere. Judges compare dated commits against that tag. Commit
    docs/arc/prompts/claude-phase-3.md and this prompt, then `git tag avalanche-june-2026 cb3904e` (last June commit),
    `git push -u origin arc` and `git push origin avalanche-june-2026`. Never force-push. Push again after each part.
A2. Docs that no longer match the code:
    - ARCHITECTURE §7 still lists avalanche/fuji for CHAINPE_NETWORK.
    - Spec 10 says agentId is in the 402 `extra`. The proxy sends the X-CHAINPE-AGENT-ID header and the SDK reads it
      first. Keep the header, correct the spec.
    - Spec 05 uses `routes.json`, but the code uses `config.routes`. Its flat Discovery shape is also wrong. Live items
      are { resource, type, x402Version, lastUpdated, accepts, metadata: { provider: { name, website, docsUrl,
      openApiUrl, description, category, tags }, path, method, description, mimeType, input, output,
      supportsVanillax402, supportsCircleGateway } }. Confirm against the docs and fix the spec.
    - Review doc "byte-identical": say identical once the immutables usdc and identityRegistry are filled.
A3. contracts-arc/script/smoke-test.mjs imports viem, which contracts-arc/package.json does not declare. Add it.

PART B — shared foundations
B1. chains.ts: add identityRegistry and reputationRegistry per network (addresses in ARCHITECTURE §4). Remove the
    ERC8004_IDENTITY_REGISTRY override and the empty KNOWN_IDENTITY_REGISTRY. `accountsAddress` undefined on `arc` must
    give a clean "not deployed on arc yet" error, never a call to undefined.
B2. New src/accounts.ts, typed from chainPeAccountsAbi, replaces registry.ts. Delete the legacy ChainPeRegistry client,
    its exports in index.ts, `registryAddress` and exitRegistryNotOnArc. Before any write, assert the contract's usdc()
    and identityRegistry() equal the network's values, because CHAINPE_ACCOUNTS_ADDRESS can override the address.
B3. One write helper for every transaction: simulateContract (decodes custom errors, burns no gas) → writeContract →
    waitForTransactionReceipt → throw unless receipt.status === "success". erc8004.ts does not check status today.
    Map each custom error to one actionable sentence (ServiceLimitReached → "run chainpe upgrade or deregister";
    paused; PayToNotSender; NotAgentOwner; ...). Print hash and explorer link. Key comes from resolveSellerKey, which
    already enforces key == walletAddress and therefore the contract's payTo == msg.sender rule. Never log it.
B4. Reads must separate "absent" from "could not check". Only the specific ServiceNotFound or
    ERC721NonexistentToken means absent; any other failure propagates. The existing `catch { return false/null }` in
    hasIdentity and registry.getService is a money bug here: an RPC blip would mint a duplicate identity.
B5. Config: add `publicUrl` (https, what buyers connect to), prompted in `init`. `endpoint` on-chain is always
    publicUrl and NEVER targetUrl. Publishing targetUrl would leak the backend and let buyers bypass payment,
    permanently. Refuse if: not https, host is localhost or a private IP, equal to targetUrl, or over 256 bytes.
    `--allow-http` is permitted only on arc-testnet.
B6. Client-side validation before any tx, mirroring _validateInput with BYTE lengths (Buffer.byteLength, not .length):
    name 1-64, endpoint 1-256, price 1-32, network 1-32, description ≤1024, tags ≤256.
    Price: canonical decimal string that parseUsdc accepts, no "$", > 0. The contract's digit check is not a parser
    (L-2). Network: caip2 from chains.ts. Tags joined with ",".
B7. Derive rails in ONE helper shared with routeConfig: `acceptsExact` = exact enabled AND price ≥ MIN_EXACT_PRICE_ATOMIC.
    createRoutesConfig silently drops exact under $0.01, so a naive listing would advertise a rail the 402 lacks.

PART C — identity (spec 10)
`chainpe identity [--network] [--agent-id <id>] [--update-uri] [--new]`
1. config.agentId set: require ownerOf == seller. If not, STOP with an explanation; never silently mint over it.
2. No agentId and balanceOf(seller) > 0: recover through the explorer lookup and confirm with ownerOf. One token: use
   it. Several: list them and require --agent-id. Explorer unavailable: stop and suggest --agent-id. Mint a further
   token only with explicit --new.
3. balanceOf == 0: `register(<publicUrl>/.well-known/agent.json)`, read agentId from `Registered`, save to config
   immediately. Rule 2 covers a crash between mint and save. agentId 0 is not linkable (I-1).
4. tokenURI differs from the expected URL: report it; `--update-uri` calls setAgentURI.
Agent card: served by the proxy from config, spec 10 fields plus the convention in the Arc tutorial "register your
first AI agent" (check it). `chainpe.serviceKey` is computed off-chain; test it against the contract's computeKey
view. It must never contain targetUrl or adminKey. Remove the `chainpe://seller-agent` default. `--ipfs` is out of
scope: note it as deferred in spec 10.

PART D — register, deregister, list, plan, upgrade (spec 06)
`chainpe register` is an idempotent state machine that reads first and sends only what is missing, so a re-run after
partial failure resumes, and a run with nothing to do sends ZERO transactions (test this):
- identity → no provider: registerProvider(agentId) → provider with a different agentId: setAgentId(agentId).
- service by key: absent or inactive → registerService (reactivation needs a free slot); active and different →
  updateService; active and identical → nothing.
- setAgentId does NOT refresh Service.agentId, which is a snapshot. If service.agentId != provider.agentId, call
  updateService as well, or the listing keeps agentId 0 forever.
- Pre-check activeServices < maxServices. Print key, txs, explorer links. Print a dashboard URL only if configured
  (the dashboard is Phase 6).
`chainpe deregister [--name]`: deactivateService, default config name; explain that history stays and re-registering
reactivates the same key.
`chainpe list [--mine] [--all] [--json]`: active only by default; getServices with page size ≤ 25 (L-6). On-chain
strings are attacker-controlled (L-2): strip control and ANSI characters before printing, and label endpoints unverified.
`chainpe plan`: plan, paidUntil, active/max.
`chainpe upgrade --periods <1-12> [--yes]`: read price live, show the total and ask to confirm, check ERC-20 balance
covers amount plus a gas margin (gas is USDC too, read via the 6-decimal ERC-20, never the 18-decimal native balance),
approve EXACTLY price*periods (L-3, never unlimited), subscribe, then verify paidUntil moved by periods*30 days.

PART E — doctor (spec 05)
E1. Proxy: bug to fix first. FREE_PATHS skip the gate and then fall through to the reverse proxy, for ANY method, so
    today `/openapi.json` and `/.well-known/x402` reach the provider backend unpaid. Serve them and
    `/.well-known/agent.json` locally on GET/HEAD from generated files; return 404/405 otherwise; never forward them.
    Add a test that the backend receives zero requests for these paths. Existing tests at proxy.test.ts:353 expect 200
    and need updating. Keep the traversal tests at :361-362 passing.
E2. Generate openapi.json, the /.well-known/x402 document and discovery.json next to the config, from config.routes
    plus sampled responses (`--sample <file>`, or `--pay`). Only a catch-all route `* /*` cannot be documented, so
    check 7 fails with "add routes to config". Add explicit routes for examples/weather-api to the demo config. Infer
    schemas with real field names; each example < 1.5 KB. Never include targetUrl. discovery.json follows the live
    metadata shape from A2.
E3. Checks 1-12 per spec, status pass/warn/fail/unknown. `unknown` (network or RPC error) is not a pass and not
    reported as "not registered". Doctor is read-only and needs no key, except `--pay`, which uses the buyer key
    CHAINPE_PRIVATE_KEY, prints the cost and is the only path that spends. Additions:
    - Check 2 fetches the live 402 from publicUrl, not localhost, and decodes it with the x402 helper.
    - Check 6 compares every route's live accepts with the served doc and prints a diff on drift.
    - Check 9 (L-1) requires ownerOf(agentId) == seller AND providers(seller).agentId == config.agentId AND
      service.agentId equal to it AND tokenURI == expected URL.
    - Check 10 requires the service to be active AND on-chain endpoint, price, payTo, network and rails to equal
      config AND the live 402.
    - Check 12 matches `resource` exactly across pagination. The `network` filter appears to return items with any
      matching accept, so check the accepts yourself. Info only.
E4. `--json` validates against docs/arc/specs/schemas/doctor.schema.json (create it). Exit 1 if a required check fails
    or is unknown. On success print Circle's intake fields (endpoint, payout wallet, description, OpenAPI URL; form:
    https://forms.gle/7YFzvdmMcn1JH5tF6) and note the payout wallet is sanctions-screened and listed services are
    continuously health-checked. No heartbeat to the cloud yet (Phase 5): leave a clean seam.

PART F — live acceptance on Arc testnet
F0. Before any on-chain write, STOP AND ASK ME for the public HTTPS URL. It goes on-chain and into the agent URI, so it
    should be stable. Recommend a Railway deploy of the CLI proxy plus examples/weather-api. Do NOT reuse
    examples/proxy-railway as is: it is Avalanche and x402 v1. A tunnel is acceptable only for a first pass, followed
    by `register` and `identity --update-uri` on the stable URL. Deploying needs my approval and my key set as a
    Railway variable by me.
F1. Update the demo config: publicUrl, routes, and a real description of at least 160 characters (check 8 otherwise
    warns and is not all green).
F2. Run and show output: `chainpe identity` → `chainpe register` → run `register` again (zero txs) → `chainpe list
    --network arc-testnet --mine` → `chainpe plan` → `chainpe doctor` → `chainpe doctor --json` → break a price in the
    served x402 file (check 6 fails with diff), then restore → `chainpe doctor --pay` (one real paid call, 200) →
    `chainpe upgrade --periods 1` (paidUntil moves from 2026-12-05 by 30 days, allowance back to 0).
F3. Clean up: `chainpe deregister --name demo-weather` so the example.com listing is no longer active. Leave
    `buyer-demo` and report it (it needs the buyer key).
F4. Independently check with cast: providers(seller).agentId == the new id, ownerOf(id) == seller,
    getService(key).agentId == id, tokenURI == expected. Append every tx to docs/arc/PROOF.md. Tick spec 06, spec 10
    (mint only; the rating item stays for Phase 7), spec 05 and BUILD-PLAN Phase 4 only for what actually passed.

Tests (vitest, mocked viem clients, no network): state machine across all states (new, provider with agentId 0,
stale snapshot, inactive, identical, limit reached, paused); no duplicate mint on RPC failure, on balance > 0, or on
mismatched config.agentId such as 273 on another owner; exact approve amount; receipt reverted throws; byte-length
validation (multibyte names); targetUrl and private hosts refused; rail derivation under $0.01; ANSI stripped in list;
doctor unknown vs fail; free paths never reach the backend; generated docs contain no targetUrl.
Run `npm test -w packages/chainpe` (or vitest in the package) and `tsc --noEmit` before each commit.

Rules
- Small dated `arc:` commits, one per item, never squash, push after each part.
- Do not change contracts or redeploy. If a contract problem blocks you, stop and report it.
- No mainnet writes. Testnet only. No packages outside packages/chainpe (buyer side is Phase 7, cloud is Phase 5).
- Reputation and feedback are out of scope. So are Pro price and dashboard work.
- Items marked VERIFY: confirm against docs or live chain and record the result in the spec.
- Stop and ask me: public URL (F0), Railway deploy, any spend beyond a few testnet USDC, a spec conflict you cannot
  resolve, or if the keyless Circle trial runs out.

Report at the end: A results (with remote branch and tag confirmed by `git ls-remote`), decisions and spec changes,
F2 output, F4 cast results, tx links, test totals, files changed, commits, and open items for Phases 5 and 7.
