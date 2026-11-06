# ChainPe demo seller on Arc: examples/weather-api behind the ChainPe proxy.
# Build from the repo root. Files are copied by name, so no .env can reach the image.
# The seller key is a Railway variable: CHAINPE_SELLER_PRIVATE_KEY.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/chainpe ./packages/chainpe
COPY examples/weather-api ./examples/weather-api
COPY examples/arc-demo ./examples/arc-demo

RUN npm ci --workspace=@chainpeavax/cli --include-workspace-root --ignore-scripts \
  && npm run build --workspace=@chainpeavax/cli

ENV NODE_ENV=production
ENV CHAINPE_CONFIG=/app/examples/arc-demo/config.json

CMD ["sh", "examples/arc-demo/start.sh"]
