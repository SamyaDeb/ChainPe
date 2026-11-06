# Arc demo seller

`examples/weather-api` behind the ChainPe proxy, as one Railway service. Buyers reach only the proxy, on Railway's
`$PORT`. The backend listens on 3001 inside the container, and the paying proxy is its only public route.

`config.json` holds public values only and is committed. It is what `chainpe register` publishes. The generated
`config.*.json` files are served at `/openapi.json` and `/.well-known/x402`.

| Railway variable | Value |
|---|---|
| `CHAINPE_SELLER_PRIVATE_KEY` | Key of the payout wallet in `config.json`. Set it yourself in the Railway dashboard. It never goes in this repo |
| `RAILWAY_DOCKERFILE_PATH` | `examples/arc-demo/Dockerfile` |

After changing `config.json`, run from the repo root:

```sh
CHAINPE_CONFIG=examples/arc-demo/config.json node packages/chainpe/dist/cli.js doctor --regenerate
```

Then commit and redeploy. Doctor reads the deployed URL, so it reports drift until the new version is live.
