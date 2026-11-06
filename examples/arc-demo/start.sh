#!/bin/sh
# Runs the backend on a private port and the paying proxy on Railway's public one.
# If either exits, the container exits, so Railway restarts it rather than leaving half a service.
set -e

PORT=3001 node examples/weather-api/server.mjs &
backend=$!

node packages/chainpe/dist/cli.js start --port "${PORT:-4402}" &
proxy=$!

while kill -0 "$backend" 2>/dev/null && kill -0 "$proxy" 2>/dev/null; do
  sleep 2
done
exit 1
