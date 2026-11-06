# chainpe-cloud

Backend of the ChainPe provider dashboard: wallet sign-in, proxy telemetry, Arc indexing and verified revenue.
Design: [`docs/arc/specs/08a-cloud-design.md`](../../docs/arc/specs/08a-cloud-design.md). API: [`openapi.yaml`](./openapi.yaml), with
real sample responses in [`fixtures/`](./fixtures).

It holds no private keys. Revenue counts only events matched to a USDC Transfer log on Arc or to Circle's Gateway transfer record.

```sh
createdb chainpe_cloud_test
npm install
npm test            # real Postgres; set TEST_DATABASE_URL to use another database
npm run db:generate # after changing src/schema.ts; migrations apply at boot
npm run fixtures    # after changing a response; regenerates fixtures/ from real responses
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres URL |
| `SESSION_SECRET` | At least 32 characters: `openssl rand -hex 32`. Changing it ends every session |
| `ARC_RPC_URL` | `https://rpc.testnet.arc.io`. The public RPC rate-limits, so catching up takes a while |
| `CHAIN_ID` | `5042002` (default) |
| `CHAINPE_ACCOUNTS_ADDRESS` | `0xD315322c9D83A6f50A04236A2a242e0259bfB580` |
| `ACCOUNTS_DEPLOY_BLOCK` | `70918643` |
| `ERC8004_IDENTITY_REGISTRY` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| `ERC8004_REPUTATION_REGISTRY` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| `CIRCLE_GATEWAY_URL` | `https://gateway-api-testnet.circle.com` |
| `CORS_ORIGIN` | The dashboard's origin. Comma-separated for several |
| `SIWE_DOMAIN` | The dashboard's host. Wallets warn unless this matches the page |
| `SIWE_CLI_DOMAIN` | This API's host. `chainpe login` refuses to sign for any other |
| `WORKERS_ENABLED` | `true` (default). `false` runs the API alone |
