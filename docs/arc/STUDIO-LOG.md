# Arc Studio log (evidence for judges)

Shareable workspace URL: https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a

| Date (IST) | Run | Prompt file | status | webUrl | traceId | Deployments (address · network · tx) | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-06 02:15 | 1 | prompts/studio-01-contracts.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1ad70-000a-71b4-bd44-b79fdb929e60` | `0x1fd61443d8ec25b41c4e2bd5e010109e6aefefbb` · Arc testnet · `0x346e9bc5e3524fb0b0ccc6bd0b845dab67927775d866f36367b3758ad2b3f430` | 90 tests. Superseded by 1b: review finding M-1 |
| 2026-11-06 02:25 | 1b | prompts/studio-01b-fixes.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1ad7b-0d83-75fc-8402-034ab6dad06d` | `0xD315322c9D83A6f50A04236A2a242e0259bfB580` · Arc testnet · `0xc6fc0f559ded0557ac36e2f306d6cbe311f6be2d614ebb0318d15bef72f12497` | 101 tests. Bound `payTo` to the provider. **Current** |
| 2026-11-06 | 2 | prompts/studio-02-dashboard.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af33-05bb-768e-9d2c-e340331edfc7` | none | Dashboard built; contract and ABI byte-identical afterwards |
| 2026-11-06 | 2b | prompts/studio-02b-fixes.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af47-bdd5-74bc-b654-b4dbce89e93c` | none | Fixes from reviews/dashboard-review.md |
| 2026-11-06 | 3 | prompts/studio-03-review.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af4a-2094-702b-901d-599065e1707f` | none | Dashboard polish only: contracts frozen this phase |
| 2026-11-06 | 4 | prompts/studio-04-restyle.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af5b-7ebc-7736-add0-c37208d471a3` | none | Landing-page restyle from `arc-dashboard-restyle` at cd2c1ca, applied unchanged: returned files byte-identical |
| 2026-11-06 | 5 | prompts/studio-05-numbers.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af60-57c1-71aa-8470-d67712329e65` | none | Real numbers on every frame: `Motion.tsx` only |
| 2026-11-06 | 6 | prompts/studio-06-base-path.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1af67-36a6-712a-9e41-ac20f0e27ea6` | none | Serves the dashboard under /dashboard for chainpe.vercel.app |
| 2026-11-06 | 7 | prompts/studio-07-wallets.md | completed | https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a | `01a1afbd-d028-7311-957c-01f8f8f5b31a` | none | RainbowKit wallets and QR sign-in, reviewed outside Studio and applied unchanged: only `bun.lock` changed. An earlier try ran from `apps/arc-dashboard` and created a separate app, `364f4560-84d0-41b7-8f43-f67d49c27074`, which is not this workspace |
