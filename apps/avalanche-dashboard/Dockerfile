# Builds the dashboard under /dashboard/ and serves it with Caddy. Build with this folder as the context.
# VITE_ values are public and baked in at build time, so they come in as build args (Railway passes service variables).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: only native WebSocket add-ons (bufferutil, utf-8-validate) have install scripts, and a browser build needs neither.
RUN npm ci --legacy-peer-deps --ignore-scripts
COPY . .
ARG VITE_CHAINPE_CLOUD_URL
ARG VITE_WALLETCONNECT_PROJECT_ID
ARG VITE_BASE_PATH=/dashboard/
ENV VITE_CHAINPE_CLOUD_URL=$VITE_CHAINPE_CLOUD_URL VITE_BASE_PATH=$VITE_BASE_PATH
RUN if [ -n "$VITE_WALLETCONNECT_PROJECT_ID" ]; then export VITE_WALLETCONNECT_PROJECT_ID; fi; npx tsc --noEmit && npx vite build

FROM caddy:2.8-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
