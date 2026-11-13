---
id: api-reference-facilitator
title: Facilitator API
sidebar_position: 2
---

# Facilitator API

The facilitator is a non-custodial x402 settlement service. It implements the x402 facilitator HTTP contract used by the `x402-express` middleware.

**Base URL:** `https://chainpe-facilitator-production.up.railway.app`

---

## GET /

Service info.

**Response:**
```json
{
  "service": "chainpe-facilitator",
  "description": "Non-custodial x402 verify + settle for USDC on Avalanche.",
  "network": "avalanche",
  "custodial": false,
  "endpoints": ["/health", "/status", "/supported", "/metrics", "/verify", "/settle"]
}
```

---

## GET /health

Liveness check. Used by Railway as a health probe.

**Response (healthy):**
```json
HTTP 200
{
  "status": "ok",
  "service": "chainpe-facilitator",
  "network": "avalanche",
  "x402Network": "avalanche",
  "facilitator": "0x8cC8dADfAd2D39659314106bAf4Da10B3BA38A36",
  "custodial": false
}
```

**Response (low gas):**
```json
HTTP 503
{
  "status": "degraded",
  "reason": "low_gas",
  "service": "chainpe-facilitator",
  "network": "avalanche",
  "facilitator": "0x8cC8...",
  "gasBalanceAvax": "0.004"
}
```

Returns HTTP 503 when the AVAX balance drops below 0.05 AVAX. Railway will restart or alert on 503.

**cURL:**
```bash
curl https://chainpe-facilitator-production.up.railway.app/health
```

---

## GET /status

Detailed operational status including a live gas balance RPC call.

**Response:**
```json
{
  "service": "chainpe-facilitator",
  "network": "avalanche",
  "x402Network": "avalanche",
  "facilitator": "0x8cC8...",
  "gasBalanceAvax": "0.312",
  "lowGas": false
}
```

---

## GET /supported

Returns supported x402 schemes and networks.

**Response:**
```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "avalanche"
    }
  ]
}
```

---

## GET /metrics

Prometheus text-format metrics for monitoring.

**Response:**
```
Content-Type: text/plain; version=0.0.4; charset=utf-8

# HELP chainpe_verify_total Total /verify requests handled
# TYPE chainpe_verify_total counter
chainpe_verify_total{result="success"} 42
chainpe_verify_total{result="error"} 1

# HELP chainpe_settle_total Total /settle requests handled
# TYPE chainpe_settle_total counter
chainpe_settle_total{result="success"} 40
chainpe_settle_total{result="error"} 2

# HELP chainpe_gas_balance_avax Current gas key AVAX balance
# TYPE chainpe_gas_balance_avax gauge
chainpe_gas_balance_avax{network="avalanche",facilitator="0x8cC8..."} 0.312
```

---

## POST /verify

Verify a payment payload without submitting a transaction.

**Rate limit:** 60 req/min per IP

**Request body:**
```ts
interface VerifyRequest {
  paymentPayload: PaymentPayload     // signed x402 authorization
  paymentRequirements: PaymentRequirements  // the offer from the 402 response
}
```

`PaymentPayload` structure (from x402 library):
```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "avalanche",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xAgentWallet",
      "to": "0xProviderWallet",
      "value": "10000",
      "validAfter": "1718000000",
      "validBefore": "1718000300",
      "nonce": "0x1234..."
    }
  }
}
```

`PaymentRequirements`:
```json
{
  "scheme": "exact",
  "network": "avalanche",
  "maxAmountRequired": "10000",
  "resource": "https://api.example.com/data",
  "description": "API call",
  "mimeType": "application/json",
  "payTo": "0xProviderWallet",
  "maxTimeoutSeconds": 300,
  "asset": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  "outputSchema": null,
  "extra": null
}
```

**Response (valid):**
```json
HTTP 200
{ "isValid": true }
```

**Response (invalid):**
```json
HTTP 200
{ "isValid": false, "invalidReason": "invalid_signature" }
```

**Response (bad request):**
```json
HTTP 400
{ "isValid": false, "invalidReason": "verify_failed" }
```

**cURL:**
```bash
curl -X POST https://chainpe-facilitator-production.up.railway.app/verify \
  -H "Content-Type: application/json" \
  -d '{ "paymentPayload": {...}, "paymentRequirements": {...} }'
```

---

## POST /settle

Verify and settle a payment on Avalanche. Submits a `USDC.transferWithAuthorization` transaction.

**Rate limit:** 60 req/min per IP

**Request body:** same as `/verify`

**Response (success):**
```json
HTTP 200
{
  "success": true,
  "transaction": "0xabc123def456...",
  "network": "avalanche"
}
```

**Response (failure):**
```json
HTTP 400
{
  "success": false,
  "errorReason": "settle_failed",
  "transaction": "",
  "network": "avalanche"
}
```

**cURL:**
```bash
curl -X POST https://chainpe-facilitator-production.up.railway.app/settle \
  -H "Content-Type: application/json" \
  -d '{ "paymentPayload": {...}, "paymentRequirements": {...} }'
```
