#!/usr/bin/env bash
# Checks a ChainPeAccounts deployment on-chain against what we expect. Reads only; needs no key.
# Usage: script/verify-deploy.sh <address> [rpc-url]
set -euo pipefail

ADDRESS="${1:?usage: verify-deploy.sh <address> [rpc-url]}"
RPC="${2:-https://rpc.testnet.arc.io}"

EXPECTED_USDC=0x3600000000000000000000000000000000000000
EXPECTED_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
EXPECTED_OWNER=0x3b8a312fac101E7163F9701457d8Dc46cE8fd30a
EXPECTED_PRICE=1000000
EXPECTED_PERIOD=2592000

failed=0
check() { # label actual expected
  if [ "$(printf %s "$2" | tr '[:upper:]' '[:lower:]')" = "$(printf %s "$3" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "PASS  $1 = $2"
  else
    echo "FAIL  $1 = $2 (expected $3)"
    failed=1
  fi
}
read_uint() { cast call "$ADDRESS" "$1(address)(uint256)" "$2" --rpc-url "$RPC" | awk '{print $1}'; }
call() { cast call "$ADDRESS" "$1" --rpc-url "$RPC" | awk '{print $1}'; }

code=$(cast code "$ADDRESS" --rpc-url "$RPC")
if [ "${#code}" -gt 2 ]; then echo "PASS  code present, $(( (${#code} - 2) / 2 )) bytes"; else echo "FAIL  no code"; failed=1; fi

check "usdc()" "$(call 'usdc()(address)')" "$EXPECTED_USDC"
check "identityRegistry()" "$(call 'identityRegistry()(address)')" "$EXPECTED_REGISTRY"
check "owner()" "$(call 'owner()(address)')" "$EXPECTED_OWNER"
check "treasury()" "$(call 'treasury()(address)')" "$EXPECTED_OWNER"
check "proPricePerPeriod()" "$(call 'proPricePerPeriod()(uint256)')" "$EXPECTED_PRICE"
check "PERIOD()" "$(call 'PERIOD()(uint256)')" "$EXPECTED_PERIOD"
check "pendingOwner()" "$(call 'pendingOwner()(address)')" 0x0000000000000000000000000000000000000000
check "paused()" "$(call 'paused()(bool)')" false

exit "$failed"
