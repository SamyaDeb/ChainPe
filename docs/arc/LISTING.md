# Circle "Get listed" intake

Fields printed by `chainpe doctor` on 2026-11-06, with all required checks green. **Not submitted.** You submit this yourself.

**Form:** https://forms.gle/7YFzvdmMcn1JH5tF6

| Field | Value |
|---|---|
| Endpoint URL | `https://chainpe-arc-demo-production.up.railway.app` |
| Payout wallet | `0x261f058496D81703c858DDFEd201834F0b5f2e73` |
| Description | Current weather and 5-day forecasts for any city, as clean JSON your agent can parse. No API key or signup: pay per call in USDC on Arc over x402, from $0.001 per request. |
| OpenAPI URL | `https://chainpe-arc-demo-production.up.railway.app/openapi.json` |

Doctor's notes: the payout wallet is sanctions-screened during review, and listed services are health-checked continuously, so keep the endpoint up.

## Before submitting

- This is a demo on **testnet** with sample weather data. Check that Circle wants a testnet listing at this stage.
- The category in `examples/arc-demo/config.json` is `DATA_ENRICHMENT`. Circle's docs were not checked for this: it is a value seen on live listings, chosen as the closest fit.
- Rerun `chainpe doctor` first, in case anything changed since.
