#!/usr/bin/env bash
# Register one of the demo proxy routes on ChainPeRegistry (Avalanche mainnet).
#
#   examples/proxy-railway/register.sh <weather|summarize|cheap-weather> <payTo wallet> <proxy base URL>
#
# Each service uses its own wallet: it signs the registration, receives the USDC, and gets its own
# ERC-8004 identity (the CLI mints one only when the wallet has none yet). The config is written to
# an isolated HOME under .chainpe-register/<service>, so your own ~/.chainpe/config.json is untouched.
#
# `chainpe register` is interactive. When it asks:
#   - Public endpoint URL   → paste the URL this script prints
#   - Sign method           → "Paste private key" (the browser flow cannot mint the ERC-8004 identity)
#   - Private key           → the key for <payTo wallet>
# It then mints the identity, approves the 1 USDC fee and registers. Nothing is sent before you confirm.
set -euo pipefail

SERVICE="${1:-}"; WALLET="${2:-}"; BASE="${3:-}"
if [[ -z "$SERVICE" || -z "$WALLET" || -z "$BASE" ]]; then
  echo "usage: $0 <weather|summarize|cheap-weather> <payTo wallet 0x…> <proxy base URL https://…>" >&2
  exit 1
fi
[[ "$WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "invalid wallet address: $WALLET" >&2; exit 1; }
BASE="${BASE%/}"

case "$SERVICE" in
  weather)
    NAME="weather"; PRICE="0.01"; TAGS='["weather","data","demo"]'
    DESC="Current weather for a city. Call with ?city=London. Sample data, settled in USDC via x402." ;;
  summarize)
    NAME="summarize"; PRICE="0.02"; TAGS='["ai","summarize","text","demo"]'
    DESC="Extractive text summary. Call with ?text=... or POST {\"text\": \"...\"}. Deterministic, no LLM keys." ;;
  cheap-weather)
    NAME="cheap-weather"; PRICE="0.005"; TAGS='["weather","data","demo"]'
    DESC="Cheap weather for a city. Call with ?city=London. Settled in USDC via x402." ;;
  *) echo "unknown service: $SERVICE" >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/packages/chainpe/dist/cli.js"
[[ -f "$CLI" ]] || { echo "build the CLI first: npm run build:cli (in $ROOT)" >&2; exit 1; }

REG_HOME="$ROOT/.chainpe-register/$SERVICE"
mkdir -p "$REG_HOME/.chainpe"
CONFIG="$REG_HOME/.chainpe/config.json"
if [[ ! -f "$CONFIG" ]]; then
  # Keep an existing file: it holds the agentId after a first run, so a re-run reuses the identity.
  NAME="$NAME" DESC="$DESC" TAGS="$TAGS" PRICE="$PRICE" WALLET="$WALLET" TARGET="$BASE/$SERVICE" CONFIG="$CONFIG" \
  node -e '
    const e = process.env
    const config = {
      serviceName: e.NAME,
      serviceDescription: e.DESC,
      tags: JSON.parse(e.TAGS),
      targetUrl: e.TARGET,
      pricePerRequest: e.PRICE,
      paymentToken: "USDC",
      walletAddress: e.WALLET,
      proxyPort: 4402,
      network: "avalanche",
      facilitatorUrl: "https://chainpe-facilitator-production-000a.up.railway.app",
      logLevel: "normal",
    }
    require("fs").writeFileSync(e.CONFIG, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  '
fi

echo
echo "  Service:  $NAME  ($PRICE USDC)"
echo "  payTo:    $WALLET"
echo "  Config:   $CONFIG"
echo
echo "  When asked for the public endpoint URL, paste:"
echo "    $BASE/$SERVICE"
echo
HOME="$REG_HOME" node "$CLI" register
