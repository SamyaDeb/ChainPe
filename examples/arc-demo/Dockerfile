# ChainPe demo seller on Arc: examples/weather-api behind the ChainPe proxy.
# Build from the repo root. Files are copied by name, so no .env can reach the image.
# The seller key is a Railway variable: CHAINPE_SELLER_PRIVATE_KEY.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
# npm ci checks the lock file against every workspace, so each one's manifest must be here, though only the CLI is built.
COPY packages/chainpe-agent/package.json ./packages/chainpe-agent/package.json
COPY packages/chainpe-ai-tools/package.json ./packages/chainpe-ai-tools/package.json
COPY packages/chainpe-sdk/package.json ./packages/chainpe-sdk/package.json
COPY packages/chainpe-wallet/package.json ./packages/chainpe-wallet/package.json
COPY packages/chainpe ./packages/chainpe
COPY examples/weather-api ./examples/weather-api
COPY examples/arc-demo ./examples/arc-demo

RUN npm ci --workspace=@chainpeavax/cli --include-workspace-root --ignore-scripts \
  && npm run build --workspace=@chainpeavax/cli

ENV NODE_ENV=production
ENV CHAINPE_CONFIG=/app/examples/arc-demo/config.json

CMD ["sh", "examples/arc-demo/start.sh"]
