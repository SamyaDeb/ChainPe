# Proof of live Arc testnet activity

Every live artefact from the ChainPe port to Arc, oldest first. Times are IST, taken from the block timestamp where
there is a transaction. Chain: Arc testnet (`eip155:5042002`).

ChainPeAccounts source is verified on the explorer: [0xD315322c9D83A6f50A04236A2a242e0259bfB580](https://explorer.testnet.arc.io/address/0xD315322c9D83A6f50A04236A2a242e0259bfB580). Arc Studio workspace: https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a.

| Date (IST) | What | Tx / transfer id | Explorer |
|---|---|---|---|
| 2026-11-06 01:55 | Buyer deposit of 1.00 USDC into Gateway | `0x5c05705f9945fba7815d3511c9f717a0922dee8f534f076e4ffcbb8a8fcacb81` | [view](https://explorer.testnet.arc.io/tx/0x5c05705f9945fba7815d3511c9f717a0922dee8f534f076e4ffcbb8a8fcacb81) |
| 2026-11-06 01:55 | Paid API call, exact rail, Circle Facilitator ($0.01) | `0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9` | [view](https://explorer.testnet.arc.io/tx/0x11027eae23b4efd8419e7fdfae073622d6096efb0767882d30a71080df83c6c9) |
| 2026-11-06 01:55 | Paid API call, Gateway rail ($0.001) | `393435a2-78e7-45c3-bfd8-9f85d7b87930` | Gateway transfer id, settled in the batch below |
| 2026-11-06 01:56 | Gateway batch settling that call | `0xccffd62c1f3dc573deb7cff643d62560043da11794da8875ce03af4951691ab6` | [view](https://explorer.testnet.arc.io/tx/0xccffd62c1f3dc573deb7cff643d62560043da11794da8875ce03af4951691ab6) |
| 2026-11-06 02:06 | Seller deposit of 0.01 USDC into Gateway | `0xa0d1d20514ad84ca5d9c80a68841763e0c6b2ec2de30f49bebf5c1a952d270ce` | [view](https://explorer.testnet.arc.io/tx/0xa0d1d20514ad84ca5d9c80a68841763e0c6b2ec2de30f49bebf5c1a952d270ce) |
| 2026-11-06 02:07 | Seller withdrawal of 0.001 USDC from Gateway (mint) | `0x0d45e8f011e835740846014329bf6c8aaab49df350a77ad0cdc62b82642652a7` | [view](https://explorer.testnet.arc.io/tx/0x0d45e8f011e835740846014329bf6c8aaab49df350a77ad0cdc62b82642652a7) |
| 2026-11-06 02:07 | Seller `withdraw --all`, 0.003 USDC (mint) | `0x0a8980435809e3cab8f664ee92a8da553fa572f709f4a89272ad57610eedf3bf` | [view](https://explorer.testnet.arc.io/tx/0x0a8980435809e3cab8f664ee92a8da553fa572f709f4a89272ad57610eedf3bf) |
| 2026-11-06 02:15 | ChainPeAccounts run 1 deployed through Arc Studio (superseded: no `payTo` check) | `0x346e9bc5e3524fb0b0ccc6bd0b845dab67927775d866f36367b3758ad2b3f430` | [view](https://explorer.testnet.arc.io/tx/0x346e9bc5e3524fb0b0ccc6bd0b845dab67927775d866f36367b3758ad2b3f430) |
| 2026-11-06 02:25 | **ChainPeAccounts run 1b deployed through Arc Studio, current**: `0xD315322c9D83A6f50A04236A2a242e0259bfB580` | `0xc6fc0f559ded0557ac36e2f306d6cbe311f6be2d614ebb0318d15bef72f12497` | [view](https://explorer.testnet.arc.io/tx/0xc6fc0f559ded0557ac36e2f306d6cbe311f6be2d614ebb0318d15bef72f12497) |
| 2026-11-06 02:28 | Seller `registerProvider(0)` | `0x1950154bc3ee4dbc1226e94ca6106f23ad647643b761d152a2ea92ee240f6ff1` | [view](https://explorer.testnet.arc.io/tx/0x1950154bc3ee4dbc1226e94ca6106f23ad647643b761d152a2ea92ee240f6ff1) |
| 2026-11-06 02:28 | Seller `registerService(demo-weather)` on Free | `0xf9d165829e53cac583ad72802ad0b40b413e12143a45c37be3c55057be12a22a` | [view](https://explorer.testnet.arc.io/tx/0xf9d165829e53cac583ad72802ad0b40b413e12143a45c37be3c55057be12a22a) |
| 2026-11-06 02:28 | Seller second `registerService` on Free, **reverted as designed** (`ServiceLimitReached`) | `0xcc100a22ff530adeacc2ebea431f332cf7bf499a34c386f42e445251d55cd9c0` | [view](https://explorer.testnet.arc.io/tx/0xcc100a22ff530adeacc2ebea431f332cf7bf499a34c386f42e445251d55cd9c0) |
| 2026-11-06 02:28 | Seller `approve` 1 USDC | `0x3219419c0c316b1a4c881d45d2ecbe065e7cc784caea0b73a5ba67c3a73c0488` | [view](https://explorer.testnet.arc.io/tx/0x3219419c0c316b1a4c881d45d2ecbe065e7cc784caea0b73a5ba67c3a73c0488) |
| 2026-11-06 02:28 | Seller `subscribe(1)`: 1 USDC to treasury, `planOf` = 1 | `0xa8b116b3af98f7f6ef8c3b36478493a6d415f2bc256e33ccfcd7a53b3c97cf9a` | [view](https://explorer.testnet.arc.io/tx/0xa8b116b3af98f7f6ef8c3b36478493a6d415f2bc256e33ccfcd7a53b3c97cf9a) |
| 2026-11-06 02:28 | Seller `registerService(demo-weather-2)` on Pro | `0x07522e850b80ef246b88709810e30276b9f7db1e1895ed9bb3c2dfedf3bac461` | [view](https://explorer.testnet.arc.io/tx/0x07522e850b80ef246b88709810e30276b9f7db1e1895ed9bb3c2dfedf3bac461) |
| 2026-11-06 02:28 | Seller `deactivateService(demo-weather-2)` | `0xd53496281896e1c62c18120824a08fbd99d93394f79b270fd8996eb170db32d6` | [view](https://explorer.testnet.arc.io/tx/0xd53496281896e1c62c18120824a08fbd99d93394f79b270fd8996eb170db32d6) |
| 2026-11-06 02:28 | Buyer `registerProvider(0)`, second provider | `0xa10c0e2d36a0fb0b6573069c6a62155d6e4f0c57a89e1d4dd700fc3162759341` | [view](https://explorer.testnet.arc.io/tx/0xa10c0e2d36a0fb0b6573069c6a62155d6e4f0c57a89e1d4dd700fc3162759341) |
| 2026-11-06 02:28 | Buyer `registerService(buyer-demo)` | `0x036c3c10d577c8031c140ffd321fdad4bc1c428316b0ebdf8a8ee4888786bf64` | [view](https://explorer.testnet.arc.io/tx/0x036c3c10d577c8031c140ffd321fdad4bc1c428316b0ebdf8a8ee4888786bf64) |
| 2026-11-06 09:45 | Demo seller ERC-8004 identity minted: **agentId 897796** | `0xf7003065334a3e4fcd2f24c88b2b36db24b8cd2fdcddfb23095a727eee391a52` | [view](https://explorer.testnet.arc.io/tx/0xf7003065334a3e4fcd2f24c88b2b36db24b8cd2fdcddfb23095a727eee391a52) |
| 2026-11-06 09:45 | Seller `setAgentId(897796)` on ChainPeAccounts | `0x32697d99566066225b60b051b781b7caca973835ab6169a4ec8394b5981e42b2` | [view](https://explorer.testnet.arc.io/tx/0x32697d99566066225b60b051b781b7caca973835ab6169a4ec8394b5981e42b2) |
| 2026-11-06 09:45 | Seller `registerService(ChainPe Weather Demo)`, key `0xa0e15a9e…7d00` | `0x795ab53aae135e42258405cede4e8241e23695f3bb1a031d51af8b9e70f4c994` | [view](https://explorer.testnet.arc.io/tx/0x795ab53aae135e42258405cede4e8241e23695f3bb1a031d51af8b9e70f4c994) |
| 2026-11-06 09:49 | `doctor --pay`, $0.001 `/weather`, Gateway | `849abedb-bf48-4e06-a61e-20cddcc147bf` | Gateway transfer id, settled in the batch below |
| 2026-11-06 09:49 | `doctor --pay`, $0.01 `/forecast`, Gateway | `4ee3930f-fae3-40ef-a77f-50da87c6f22f` | Gateway transfer id, settled in the batch below |
| 2026-11-06 09:50 | Phase 5 acceptance, exact rail ($0.01 `/forecast`): `verified` from the Transfer log | `0x90404e6ba982d895cc3655d6d44561e36fc34b40b8e59d5d69b7d6774244224a` | [view](https://explorer.testnet.arc.io/tx/0x90404e6ba982d895cc3655d6d44561e36fc34b40b8e59d5d69b7d6774244224a) |
| 2026-11-06 09:50 | Phase 5 acceptance, Gateway rail ($0.001 `/weather`): `verified` from Circle's record | `c23db8d9-0cc7-4fdc-987b-ab472216bae3` | Gateway transfer id, settled in the batch below |
| 2026-11-06 09:53 | Gateway batch settling those three transfers | `0x6f784cdbda4bb0defc4ca0561317d85cf1bd388b89d33f7e6bc9ed79a8d844de` | [view](https://explorer.testnet.arc.io/tx/0x6f784cdbda4bb0defc4ca0561317d85cf1bd388b89d33f7e6bc9ed79a8d844de) |

## Live services

- Demo seller: https://chainpe-arc-demo-production.up.railway.app
- chainpe-cloud API: https://chainpe-cloud-production.up.railway.app

## `chainpe doctor` (2026-11-06)

`doctor --pay`: 11 of 11, including check 11, real paid calls with 2xx. Plain `doctor` on the final deploy: 10 of 10, `ok` and `allGreen` true. Check 12 is info only: the service is
not listed by Circle yet.

## Phase 5 acceptance, against the live API (2026-11-06)

| Check | Result |
|---|---|
| Exact call visible in `GET /v1/me/payments` | 442 ms |
| Exact call `verified` from the Transfer log | 3 s. Time shown moved from the proxy's to the block's |
| Gateway call visible in `GET /v1/me/payments` | 917 ms |
| Gateway call `verified` from Circle's record, status `received` | 24 s |
| Gateway batch landed, status `completed`, tx hash on the record | 174 s |
| Revenue after 4 paid calls | 22000 atomic = 0.022 USDC: exact 0.01, Gateway settled 0.012 |
| Third wallet `0x641Be3d2064498142542BDA5a7b5a24A0bB52e4d`, unregistered | `403 not_registered` |
| Buyer's token, every read endpoint | No seller data |

Only the failure path was not seen live: no Gateway transfer has ended `failed`, so that is tested against a stubbed Circle response.
