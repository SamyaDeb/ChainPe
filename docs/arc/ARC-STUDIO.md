# Using Arc Studio (required by the prize)

Every Arc prize at ETHGlobal Mumbai requires Arc Studio as the starting point, a **shareable Studio
project URL**, and Studio shown in the demo video. We use it for the parts Studio is built for:
**Solidity on Arc** and **the dashboard web app**. Claude Code drives Studio through its CLI.

Source: `@circle-fin/arc-studio-cli` 1.2.2 README (`arc-studio agent-guide` prints the full guide).

## 1. Setup (once)

```sh
node -v                                   # ≥ 20 for Studio CLI; ≥ 22.18 for ChainPe CLI work
npm install -g @circle-fin/arc-studio-cli
arc-studio skills install --tool claude-code   # registers Arc Studio skill + subagent in Claude Code
arc-studio login                          # browser device-link; token in macOS Keychain
claude mcp add --transport http arc-docs https://docs.arc.io/mcp
arc-studio doctor
```

Facts that shape how we use it:

- The sandbox is a **Vite + Foundry** app: Solidity under `contracts/`, web code under `src/`.
- Code in: `--file local:workspace/path` (round-trip, edited in place) or `--file path` (read-only reference in `context/`).
- Limits per run: 100 files, 1 MB each, 10 MB total; prompt ≤ 10,000 chars → use `--prompt-file`.
- `.env*`, `.npmrc`, keys and certs are refused. Never pass secrets.
- Code out: `arc-studio pull --out <dir> --paths "<glob>"`; preview with `pull --changed --dry-run --diff`.
- `--output json` returns `status`, `filesChanged`, `deployments` (address, network, explorer, txHash), `webUrl`, `traceId`.
- Exit codes: 0 completed · 3 needs_input (answer with `--answers-json`) · 4 budget_exceeded · 1 error.
- Studio deploys to **Arc testnet** from its own smart account `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`, so any
  owner must be passed in explicitly. Mainnet deploys use our own keys (Hardhat/Foundry locally).

## 2. App layout in Studio

One Studio app, two areas, so the judges' URL shows everything:

| Studio path | Content | Pulled to (repo) |
|---|---|---|
| `contracts/ChainPeAccounts.sol` | provider accounts + plans (spec 06) | `contracts-arc/contracts/` |
| `contracts/PolicyVault.sol` | stretch (spec 11) | `contracts-arc/contracts/` |
| `contracts/test/*.t.sol` | Foundry tests | `contracts-arc/contracts/test/` |
| `src/**` | provider dashboard (spec 07) | `apps/arc-dashboard/src/` |

## 3. Runs (in order)

Record every run's `webUrl`, `traceId` and `deployments` in `docs/arc/STUDIO-LOG.md`
(create it on first run) — this is evidence for judges.

### Run 1 — contracts

```sh
arc-studio run --prompt-file docs/arc/prompts/studio-01-contracts.md \
  --file docs/arc/specs/06-provider-accounts.md \
  --file contracts/contracts/ChainPeRegistryUpgradeable.sol \
  --output json > .arc-studio/run1.json
jq '{status, deployments, webUrl, traceId}' .arc-studio/run1.json
arc-studio pull --changed --dry-run --diff            # preview what changed
# Pull sources one path at a time: "contracts/**" also brings Studio's out/ and cache/.
arc-studio pull --out contracts-arc --paths "contracts/ChainPeAccounts.sol"
arc-studio pull --out contracts-arc --paths "contracts/test/**"
arc-studio pull --out contracts-arc --paths "abi/**"
```

Done when: `ChainPeAccounts` deployed on Arc testnet, address in `deployments`, Foundry tests pass in Studio.
Write the address into `CHAINPE_ACCOUNTS_ADDRESS` and `docs/arc/ARCHITECTURE.md` §4.

### Run 2 — dashboard

Run after `chainpe-cloud` exposes the endpoints in spec 08 (or against its mock JSON).

```sh
arc-studio run --prompt-file docs/arc/prompts/studio-02-dashboard.md \
  --file docs/arc/specs/07-provider-dashboard.md \
  --file docs/arc/specs/08-chainpe-cloud-api.md \
  --output json > .arc-studio-run2.json
arc-studio open            # workspace link = the shareable Studio URL
arc-studio pull --out apps/arc-dashboard --paths "src/**"
arc-studio pull --out apps/arc-dashboard --paths "index.html"
arc-studio pull --out apps/arc-dashboard --paths "package.json"
arc-studio pull --out apps/arc-dashboard --paths "vite.config.*"
# check with `arc-studio ls` first; pull exact file names if a glob is rejected
```

### Run 3 — review and polish

```sh
arc-studio run --prompt-file docs/arc/prompts/studio-03-review.md --output json > .arc-studio-run3.json
```

## 4. Driving Studio from Claude Code

After `skills install`, ask Claude Code to delegate, e.g.:
"Use the Arc Studio subagent to run docs/arc/prompts/studio-01-contracts.md with the files listed in
docs/arc/ARC-STUDIO.md run 1, then pull the results into contracts-arc."

Claude Code must: check `status` (answer `needs_input` questions from the specs, never invent),
read `fileDiffs` before pulling, and log `webUrl`/`traceId`/`deployments` to STUDIO-LOG.md.

## 5. What to show judges

- The Studio workspace (`arc-studio open`) with contracts, tests and the dashboard.
- A trace (`traceId`) of the contract deployment.
- The dashboard running from Studio's preview and from the deployed URL.
