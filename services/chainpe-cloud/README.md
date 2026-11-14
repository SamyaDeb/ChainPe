# chainpe-cloud (Avalanche)

Backend of the ChainPe provider dashboard on Avalanche C-Chain: wallet sign-in, chain indexing and verified revenue.
API: [`openapi.yaml`](./openapi.yaml), with real sample responses in [`fixtures/`](./fixtures). Ported from the Arc
version on the `arc` branch.

It holds no private keys and charges nothing.

## How it differs from Arc

| | Arc | Avalanche |
|---|---|---|
| Who can sign in | A wallet with a `ChainPeAccounts` provider account | A wallet with a service in `ChainPeRegistry` |
| Plans | Free and Pro, bought with USDC | None. Everyone gets the full (Pro) view |
| Usage fee | `ChainPeFees` | None. `/v1/me/fees` reports it off |
| Payment source | Proxy telemetry, matched to a transfer | USDC transfers read from the chain. Proxy telemetry is optional |
| Rails | exact and Circle Gateway | exact only |
| USDC | Arc system emitter, 18 decimals | `0xB97E…a6E`, 6 decimals |

**Payments come from the chain.** The Avalanche CLI proxy sends no telemetry, so the indexer watches USDC transfers
into every registered service's `payTo`. A transfer for exactly a service's price counts as a verified payment to that
service. Any other amount shows as unattributed inflow, never as revenue. If a proxy does report events (`/v1/ingest`),
an event that matches a transfer takes over the indexer's record of it and adds the route and latency, so nothing
counts twice.

## Run

```sh
docker run -d --rm --name chainpe-cloud-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=chainpe_cloud_test -p 55432:5432 postgres:16-alpine
npm ci
TEST_DATABASE_URL=postgres://postgres@localhost:55432/chainpe_cloud_test npm test
npm run db:generate # after changing src/schema.ts; migrations apply at boot
npm run fixtures    # after changing a response; regenerates fixtures/ from real responses
```

## Environment

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres URL |
| `SESSION_SECRET` | At least 32 characters: `openssl rand -hex 32`. Changing it ends every session |
| `AVALANCHE_RPC_URL` | A provider RPC (Alchemy, QuickNode, Infura) is strongly recommended. The public `https://api.avax.network/ext/bc/C/rpc` caps `eth_getLogs` at 100 blocks and rate-limits |
| `CHAIN_ID` | `43114` (default) |
| `CHAINPE_REGISTRY_ADDRESS` | `0x2a589f1e4e3Cd0A3ee986cec5202aF3760E3170E` (default) |
| `REGISTRY_DEPLOY_BLOCK` | `88207990` (default). ERC-8004 reputation was deployed at 88207994, the registry at 88208064 |
| `USDC_ADDRESS` | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (default) |
| `ERC8004_IDENTITY_REGISTRY` | `0xB1330d7B1b083ba689C7f56bDf667F1F528a3195` (default) |
| `ERC8004_REPUTATION_REGISTRY` | `0xfe7Df66e6BFbd3A76B68dF26b9312E6c85a38543` (default) |
| `GETLOGS_MAX_BLOCKS` | `2000` (default). Set `100` on the public RPC, which refuses larger `eth_getLogs` ranges |
| `GETLOGS_GAP_MS` | `400` (default). Set `1000` on the public RPC, whose Cloudflare limit answers error 1015 |
| `CORS_ORIGIN` | The dashboard's origin. Comma-separated for several |
| `SIWE_DOMAIN` | The dashboard's host, or several comma-separated (live: `chainpe.vercel.app,chainpe-cloud-production-1d71cb77.up.railway.app`). Sign-in names the one the browser's `Origin` matches, so it works both proxied and direct |
| `SIWE_CLI_DOMAIN` | This API's host |
| `WORKERS_ENABLED` | `true` (default). `false` runs the API alone |

**First sync.** From the deploy block to today is about 12 million blocks, and each chunk takes three paced
`getLogs`. With a provider RPC at 2000 blocks per chunk that is about 6,000 chunks, a few hours. On the public RPC
(100 blocks, 1 s apart) it is 120,000 chunks, several days, so use a provider RPC for the first sync. The indexer
also shrinks the chunk by itself when an RPC refuses a range. `/health` shows `indexer.cursor` against
`indexer.head`. Until the indexer reaches a provider's first service, sign-in still works: it scans the registry
directly. Payments and ratings appear as the cursor passes them.

## Live

| | |
|---|---|
| Dashboard | https://chainpe.vercel.app/dashboard (the landing site proxies it from this service) |
| API | https://chainpe-cloud-production-1d71cb77.up.railway.app |
| Railway | project `chainpe-avalanche`, service `chainpe-cloud`, database `Postgres-kkfx` (its own: chainpe-indexer's Postgres has tables with the same names) |

The live indexer starts at block 100277210 (`REGISTRY_DEPLOY_BLOCK`), not at the registry's deploy block. Checked
before going live: the registry's only two services were registered and deregistered by block 88233864, and the
reputation registry has never had feedback, so nothing earlier would show. It runs on the public RPC with
`GETLOGS_MAX_BLOCKS=100` and `GETLOGS_GAP_MS=1000`, which keeps up with the chain.

## Deploy (Railway)

One image serves the API and the dashboard (`Dockerfile.with-dashboard`, built from the repository root). Without
`DASHBOARD_DIR` the API runs alone (`Dockerfile`).

```sh
# from the repository root, with the service linked
railway variables --service chainpe-cloud --set RAILWAY_DOCKERFILE_PATH=services/chainpe-cloud/Dockerfile.with-dashboard
railway up --service chainpe-cloud
```

`VITE_CHAINPE_CLOUD_URL` (this service's URL) must be set on the service: the dashboard build bakes it in. The
dashboard signs in on `chainpe.vercel.app` (proxied) or this service's own host, so both are in `SIWE_DOMAIN` and
`CORS_ORIGIN`.
