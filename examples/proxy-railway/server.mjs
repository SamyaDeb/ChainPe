/**
 * ChainPe x402 Proxy — Railway deployment
 *
 * All configuration comes from environment variables:
 *
 *   TARGET_URL        The backend API to proxy (required)
 *   WALLET_ADDRESS    Algorand address that receives payments (required)
 *   PRICE             Price per request as decimal, e.g. "0.02" (required)
 *   PAYMENT_TOKEN     "USDC" or "ALGO" (default: USDC)
 *   NETWORK           "testnet" or "mainnet" (default: testnet)
 *   SERVICE_NAME      Display name (default: "ChainPe Service")
 *   PORT              HTTP port (Railway injects this automatically)
 *
 * The server uses the SimplePaymentVerifier — no facilitator mnemonic needed.
 * The client (payer) signs and self-pays the ALGO network fee.
 */

import express from 'express'
import cors from 'cors'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { paymentMiddleware } from '@x402-avm/express'
import { x402ResourceServer } from '@x402-avm/core/server'
import { ExactAvmScheme } from '@x402-avm/avm/exact/server'
import algosdk from 'algosdk'

// ── Config from environment ────────────────────────────────────────────────

const TARGET_URL    = process.env.TARGET_URL
const WALLET_ADDRESS = process.env.WALLET_ADDRESS
const PRICE         = process.env.PRICE ?? '0.02'
const PAYMENT_TOKEN = (process.env.PAYMENT_TOKEN ?? 'USDC').toUpperCase()
const NETWORK       = process.env.NETWORK ?? 'testnet'
const SERVICE_NAME  = process.env.SERVICE_NAME ?? 'ChainPe Service'
const PORT          = parseInt(process.env.PORT ?? '4402', 10)

if (!TARGET_URL)    { console.error('Missing env: TARGET_URL');    process.exit(1) }
if (!WALLET_ADDRESS){ console.error('Missing env: WALLET_ADDRESS'); process.exit(1) }

// ── Constants ───────────────────────────────────────────────────────────────

const ALGO_TESTNET_CAIP2 = 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
const ALGO_MAINNET_CAIP2 = 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
const USDC_TESTNET_ASA   = 10458941
const USDC_MAINNET_ASA   = 31566704

const NETWORK_CAIP2 = NETWORK === 'mainnet' ? ALGO_MAINNET_CAIP2 : ALGO_TESTNET_CAIP2
const USDC_ASA_ID   = NETWORK === 'mainnet' ? USDC_MAINNET_ASA   : USDC_TESTNET_ASA
const ALGO_URL      = NETWORK === 'mainnet'
  ? 'https://mainnet-api.algonode.cloud'
  : 'https://testnet-api.algonode.cloud'
const IDX_URL       = NETWORK === 'mainnet'
  ? 'https://mainnet-idx.algonode.cloud'
  : 'https://testnet-idx.algonode.cloud'

// ── Amount conversion ───────────────────────────────────────────────────────

function toAtomicUnits(humanAmount, decimals = 6) {
  const [whole, frac = ''] = humanAmount.split('.')
  const padded = frac.padEnd(decimals, '0').slice(0, decimals)
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(padded)).toString()
}

// ── Simple Verifier (no facilitator mnemonic needed) ───────────────────────
// Client signs the transaction and self-pays the ~0.001 ALGO network fee.
// We verify structurally, then broadcast the already-signed group.

class SimpleVerifier {
  constructor() {
    this.algod = new algosdk.Algodv2('', ALGO_URL, '')
    this.indexer = new algosdk.Indexer('', IDX_URL, '')
  }

  async getSupported() {
    return {
      kinds: [
        { x402Version: 2, scheme: 'exact',      network: NETWORK_CAIP2 },
        { x402Version: 2, scheme: 'algo-exact',  network: NETWORK_CAIP2 },
      ],
      extensions: [],
      signers: {},
    }
  }

  _extractGroup(payload) {
    for (const candidate of [payload?.payload, payload]) {
      if (candidate && Array.isArray(candidate.paymentGroup) && candidate.paymentGroup.length > 0) {
        return { entries: candidate.paymentGroup, index: Number(candidate.paymentIndex ?? 0) }
      }
    }
    return null
  }

  _decodePayment(payload) {
    const group = this._extractGroup(payload)
    if (!group) return null
    const entry = group.entries[group.index] ?? group.entries[0]
    const bytes = new Uint8Array(Buffer.from(entry, 'base64'))
    const stxn = algosdk.decodeSignedTransaction(bytes)
    const txn = stxn.txn
    const payer = txn.sender?.toString() ?? 'unknown'
    let receiver, amount = 0n, assetId
    if (txn.type === 'axfer' && txn.assetTransfer) {
      receiver = txn.assetTransfer.receiver?.toString()
      amount   = BigInt(txn.assetTransfer.amount ?? 0)
      assetId  = BigInt(txn.assetTransfer.assetIndex ?? 0)
    } else if (txn.type === 'pay' && txn.payment) {
      receiver = txn.payment.receiver?.toString()
      amount   = BigInt(txn.payment.amount ?? 0)
    }
    return { payer, receiver, amount, assetId, type: txn.type, txId: txn.txID() }
  }

  _validate(decoded, requirements) {
    const expectedPayTo = requirements?.payTo ?? WALLET_ADDRESS
    if (decoded.receiver !== expectedPayTo)
      return { valid: false, reason: `Receiver ${decoded.receiver} ≠ ${expectedPayTo}` }

    const requiredRaw = requirements?.maxAmountRequired ?? requirements?.amount
    if (requiredRaw != null) {
      const required = BigInt(requiredRaw)
      if (decoded.amount < required)
        return { valid: false, reason: `Paid ${decoded.amount}, required ${required}` }
    }

    if (decoded.type === 'axfer') {
      const expected = BigInt(requirements?.extra?.assetId ?? USDC_ASA_ID)
      if (decoded.assetId !== expected)
        return { valid: false, reason: `Wrong asset: ${decoded.assetId} ≠ ${expected}` }
    }
    return { valid: true }
  }

  async verify(payload, requirements) {
    try {
      const decoded = this._decodePayment(payload)
      if (!decoded) return { isValid: false, invalidReason: 'Could not decode signed transaction' }
      const check = this._validate(decoded, requirements)
      if (!check.valid) return { isValid: false, invalidReason: check.reason }
      return { isValid: true, payer: decoded.payer }
    } catch (err) {
      return { isValid: false, invalidReason: `Verify error: ${err.message}` }
    }
  }

  async settle(payload, requirements) {
    const v = await this.verify(payload, requirements)
    if (!v.isValid) return { success: false, transaction: '', network: NETWORK_CAIP2, errorMessage: v.invalidReason }
    try {
      const group = this._extractGroup(payload)
      const blobs = group.entries.map(b64 => new Uint8Array(Buffer.from(b64, 'base64')))
      const paymentTxId = algosdk.decodeSignedTransaction(blobs[group.index]).txn.txID()
      try {
        await this.algod.sendRawTransaction(blobs).do()
      } catch (err) {
        if (!/already in ledger|already committed/i.test(err.message ?? '')) throw err
      }
      await algosdk.waitForConfirmation(this.algod, paymentTxId, 10)
      return { success: true, transaction: paymentTxId, network: NETWORK_CAIP2 }
    } catch (err) {
      return { success: false, transaction: '', network: NETWORK_CAIP2, errorMessage: `Broadcast failed: ${err.message}` }
    }
  }
}

// ── x402 route config ───────────────────────────────────────────────────────

function buildRouteConfig() {
  const scheme = PAYMENT_TOKEN === 'ALGO' ? 'algo-exact' : 'exact'
  const amount = toAtomicUnits(PRICE)
  const price  = PAYMENT_TOKEN === 'ALGO'
    ? amount
    : { asset: 'USDC', amount, extra: { assetId: USDC_ASA_ID, decimals: 6, assetDecimals: 6 } }

  return {
    '/*': {
      accepts: {
        scheme,
        payTo: WALLET_ADDRESS,
        price,
        network: NETWORK_CAIP2,
        maxTimeoutSeconds: 300,
        ...(PAYMENT_TOKEN === 'USDC' ? { extra: { assetId: USDC_ASA_ID, assetDecimals: 6 } } : {}),
      },
      description: `Pay ${PRICE} ${PAYMENT_TOKEN} per request`,
      resource:    TARGET_URL,
      mimeType:    'application/json',
    }
  }
}

// ── Express app ─────────────────────────────────────────────────────────────

const app = express()
app.use(cors())
app.use(express.json())

// Free health check
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', service: SERVICE_NAME, network: NETWORK, uptime: process.uptime() }))

// x402 payment middleware
const verifier = new SimpleVerifier()
const resourceServer = new x402ResourceServer(verifier)
resourceServer.register(NETWORK_CAIP2, new ExactAvmScheme())

app.use(paymentMiddleware(buildRouteConfig(), resourceServer, {
  appName: SERVICE_NAME,
  testnet: NETWORK === 'testnet',
}))

// Proxy all paid requests to the backend
app.use('/', createProxyMiddleware({
  target: TARGET_URL,
  changeOrigin: true,
  on: {
    error: (err, _req, res) => {
      console.error('Proxy error:', err.message)
      res.status(502).json({ error: 'Backend unreachable', message: err.message })
    }
  }
}))

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`ChainPe proxy started`)
  console.log(`  Service:  ${SERVICE_NAME}`)
  console.log(`  Target:   ${TARGET_URL}`)
  console.log(`  Price:    ${PRICE} ${PAYMENT_TOKEN}`)
  console.log(`  Network:  ${NETWORK}`)
  console.log(`  Wallet:   ${WALLET_ADDRESS.slice(0, 8)}...${WALLET_ADDRESS.slice(-4)}`)
  console.log(`  Port:     ${PORT}`)
})
