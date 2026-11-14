/** x402 "Try it" protocol tests. Run with `npm test`. No network, no wallet: a throwaway local key signs. */
import assert from 'node:assert/strict'
import { getAddress, recoverTypedDataAddress, verifyTypedData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { formatPrice, priceToAtomic } from '../src/lib/money'
import {
  AVALANCHE_CHAIN_ID,
  buildAuthorization,
  checkRequestUrl,
  decodePaymentHeader,
  decodePaymentResponse,
  encodePaymentHeader,
  feedbackArgs,
  parsePaymentRequired,
  paymentPayload,
  problemsWith,
  randomNonce,
  selectRequirements,
  starsToValue,
  USDC_ADDRESS,
  type PaymentRequirements,
  type ValidRequirements,
} from '../src/lib/x402'

let failed = 0
const pending: Array<Promise<void>> = []
function check(name: string, fn: () => void | Promise<void>): void {
  pending.push(
    (async () => {
      try {
        await fn()
      } catch (e) {
        failed += 1
        console.error(`${name}:`, e instanceof Error ? e.message : e)
      }
    })(),
  )
}

const PAY_TO = '0x85b7a78090E3C51F81916Fc00809C8091Ad1bbCB'
const offer = (o: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: 'exact',
  network: 'avalanche',
  maxAmountRequired: '10000',
  resource: 'https://demo.example/weather',
  description: 'Weather',
  mimeType: '',
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  asset: USDC_ADDRESS,
  extra: { name: 'USD Coin', version: '2' },
  ...o,
})
// What x402-express sends in a 402.
const body402 = { x402Version: 1, error: 'X-PAYMENT header is required', accepts: [offer()] }
const expected = { payTo: PAY_TO, priceAtomic: '10000' }

check('registry prices are decimal USDC', () => {
  assert.equal(priceToAtomic('0.01'), '10000')
  assert.equal(priceToAtomic('$0.005'), '5000')
  assert.equal(priceToAtomic('1'), '1000000')
  assert.equal(priceToAtomic('0.0000001'), null)
  assert.equal(priceToAtomic('abc'), null)
  assert.equal(priceToAtomic(''), null)
  assert.equal(formatPrice('0.01'), '$0.01')
  assert.equal(formatPrice('nope'), '—')
})

check('parses a 402 and selects the matching offer', () => {
  const pr = parsePaymentRequired(body402)
  const sel = selectRequirements(pr, expected)
  assert.equal(sel.ok, true)
})

check('rejects a body that is not x402 v1', () => {
  assert.throws(() => parsePaymentRequired({ x402Version: 2, accepts: [offer()] }), /version/)
  assert.throws(() => parsePaymentRequired({ x402Version: 1, accepts: [] }), /no payment options/)
  assert.throws(() => parsePaymentRequired('nope'), /not a JSON object/)
})

check('asset and payTo compare case-insensitively', () => {
  assert.deepEqual(problemsWith(offer({ asset: USDC_ADDRESS.toLowerCase(), payTo: PAY_TO.toUpperCase().replace('0X', '0x') }), expected), [])
})

check('refuses every unsafe offer before signing', () => {
  const refuse = (o: Partial<PaymentRequirements>, pattern: RegExp) => {
    const problems = problemsWith(offer(o), expected)
    assert.ok(problems.some((p) => pattern.test(p)), `${JSON.stringify(o)} → ${JSON.stringify(problems)}`)
  }
  refuse({ network: 'avalanche-fuji' }, /Network/)
  refuse({ network: 'base' }, /Network/)
  refuse({ scheme: 'upto' }, /Scheme/)
  refuse({ asset: '0x0000000000000000000000000000000000000001' }, /not native USDC/)
  refuse({ payTo: '0x1111111111111111111111111111111111111111' }, /registered payTo/)
  refuse({ payTo: 'nope' }, /not an address/)
  refuse({ maxAmountRequired: '10001' }, /listed price/)
  refuse({ maxAmountRequired: '1000000' }, /listed price/)
  refuse({ maxAmountRequired: '0.01' }, /atomic/)
  refuse({ maxTimeoutSeconds: 301 }, /over the 300/)
  refuse({ maxTimeoutSeconds: Number.NaN }, /maxTimeoutSeconds/)
  refuse({ extra: {} }, /extra\.name/)
  assert.deepEqual(problemsWith(offer({ maxTimeoutSeconds: 300 }), expected), [])
})

check('selection reports why it refused, and skips offers on other networks', () => {
  const none = selectRequirements(parsePaymentRequired({ x402Version: 1, accepts: [offer({ network: 'base' })] }), expected)
  assert.equal(none.ok, false)
  if (!none.ok) assert.match(none.problems[0] ?? '', /No "exact" offer on Avalanche/)
  const mixed = selectRequirements(parsePaymentRequired({ x402Version: 1, accepts: [offer({ network: 'base' }), offer()] }), expected)
  assert.equal(mixed.ok, true)
  const wrong = selectRequirements(parsePaymentRequired({ x402Version: 1, accepts: [offer({ maxAmountRequired: '99' })] }), expected)
  assert.equal(wrong.ok, false)
})

check('nonces are 32 random bytes', () => {
  const a = randomNonce()
  const b = randomNonce()
  assert.match(a, /^0x[0-9a-f]{64}$/)
  assert.notEqual(a, b)
})

check('builds the EIP-3009 authorization and typed data', () => {
  const nonce = `0x${'ab'.repeat(32)}` as const
  const from = '0x24bc730c658201bc51873f7aeaade65a545c7a11'
  const { authorization, typedData } = buildAuthorization({ from, requirements: offer() as ValidRequirements, nowSec: 1_800_000_000, nonce })
  assert.deepEqual(authorization, {
    from: getAddress(from),
    to: PAY_TO,
    value: '10000',
    validAfter: '1799999940',
    validBefore: '1800000060',
    nonce,
  })
  assert.deepEqual(typedData.domain, { name: 'USD Coin', version: '2', chainId: AVALANCHE_CHAIN_ID, verifyingContract: USDC_ADDRESS })
  assert.equal(typedData.primaryType, 'TransferWithAuthorization')
  assert.equal(typedData.message.value, 10000n)
  assert.equal(typedData.message.validBefore, 1_800_000_060n)
})

check('the signed X-PAYMENT header has the x402 v1 shape and recovers to the payer', async () => {
  const account = privateKeyToAccount(generatePrivateKey())
  const requirements = offer() as ValidRequirements
  const { authorization, typedData } = buildAuthorization({ from: account.address, requirements, nowSec: Math.floor(Date.now() / 1000), nonce: randomNonce() })
  const signature = await account.signTypedData(typedData)
  const header = encodePaymentHeader(paymentPayload(requirements, authorization, signature))
  assert.match(header, /^[A-Za-z0-9+/]+=*$/)
  const decoded = decodePaymentHeader(header)
  assert.deepEqual(Object.keys(decoded), ['x402Version', 'scheme', 'network', 'payload'])
  assert.deepEqual(Object.keys(decoded.payload), ['signature', 'authorization'])
  assert.deepEqual(Object.keys(decoded.payload.authorization), ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'])
  assert.equal(decoded.x402Version, 1)
  assert.equal(decoded.scheme, 'exact')
  assert.equal(decoded.network, 'avalanche')
  for (const k of ['value', 'validAfter', 'validBefore'] as const) assert.match(decoded.payload.authorization[k], /^\d+$/)
  // What the facilitator does: rebuild the typed data from the header and recover the signer.
  const a = decoded.payload.authorization
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    signature: decoded.payload.signature,
  })
  assert.equal(recovered, account.address)
  assert.equal(await verifyTypedData({ address: account.address, ...typedData, signature }), true)
})

check('matches the header the SDK builds with x402/client, when that package is installed', async () => {
  type Lib = { createPaymentHeader: (c: unknown, v: number, r: unknown) => Promise<string> }
  let lib: Lib
  try {
    const specifier = 'x402/client'
    lib = (await import(specifier)) as Lib
  } catch {
    console.log('  (x402 not installed next to the dashboard: skipped the SDK cross-check)')
    return
  }
  const account = privateKeyToAccount(generatePrivateKey())
  const theirs = decodePaymentHeader(await lib.createPaymentHeader(account, 1, offer()))
  const requirements = offer() as ValidRequirements
  const { authorization, typedData } = buildAuthorization({ from: account.address, requirements, nowSec: Math.floor(Date.now() / 1000), nonce: theirs.payload.authorization.nonce })
  const ours = decodePaymentHeader(encodePaymentHeader(paymentPayload(requirements, authorization, await account.signTypedData(typedData))))
  assert.deepEqual(Object.keys(ours), Object.keys(theirs))
  assert.deepEqual(Object.keys(ours.payload), Object.keys(theirs.payload))
  assert.deepEqual(Object.keys(ours.payload.authorization), Object.keys(theirs.payload.authorization))
  assert.equal(ours.network, theirs.network)
  assert.equal(ours.payload.authorization.value, theirs.payload.authorization.value)
  assert.equal(ours.payload.authorization.to.toLowerCase(), theirs.payload.authorization.to.toLowerCase())
  // The library signs the same typed data: its signature verifies against our domain.
  const t = theirs.payload.authorization
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    message: { from: t.from, to: t.to, value: BigInt(t.value), validAfter: BigInt(t.validAfter), validBefore: BigInt(t.validBefore), nonce: t.nonce },
    signature: theirs.payload.signature,
  })
  assert.equal(recovered, account.address)
})

check('decodes X-PAYMENT-RESPONSE', () => {
  const tx = `0x${'1f'.repeat(32)}`
  const header = btoa(JSON.stringify({ success: true, transaction: tx, network: 'avalanche', payer: '0xabc' }))
  const s = decodePaymentResponse(header)
  assert.equal(s?.success, true)
  assert.equal(s?.transaction, tx)
  assert.equal(s?.network, 'avalanche')
  assert.equal(decodePaymentResponse(null), null)
  assert.equal(decodePaymentResponse('%%%'), null)
  assert.equal(decodePaymentResponse(btoa(JSON.stringify({ success: true, transaction: 'nope' })))?.transaction, null)
})

check('only calls https URLs on the service endpoint', () => {
  assert.equal(checkRequestUrl('https://demo.example/weather', 'https://demo.example/weather?city=Paris').search, '?city=Paris')
  assert.throws(() => checkRequestUrl('http://demo.example/weather', 'http://demo.example/weather'), /https/)
  assert.throws(() => checkRequestUrl('https://demo.example/weather', 'https://evil.example/weather'), /stay on/)
  assert.throws(() => checkRequestUrl('https://demo.example/weather', 'https://demo.example/admin'), /stay on/)
  assert.throws(() => checkRequestUrl('https://demo.example/weather', 'https://u:p@demo.example/weather'), /credentials/)
  assert.throws(() => checkRequestUrl('https://demo.example/weather', 'not a url'), /valid URL/)
})

check('giveFeedback arguments carry the payment as proof', () => {
  const tx = `0x${'2e'.repeat(32)}`
  assert.deepEqual(feedbackArgs({ agentId: '41', stars: 4, url: 'https://demo.example/weather?city=Paris&key=secret', settlementTx: tx }), [
    41n,
    80n,
    0,
    'x402',
    '',
    'https://demo.example/weather',
    '',
    tx,
  ])
  assert.deepEqual([1, 2, 3, 4, 5].map(starsToValue), [20, 40, 60, 80, 100])
  assert.throws(() => starsToValue(0))
  assert.throws(() => starsToValue(6))
  assert.throws(() => feedbackArgs({ agentId: '0', stars: 5, url: 'https://a.example/', settlementTx: tx }), /no ERC-8004/)
  assert.throws(() => feedbackArgs({ agentId: '41', stars: 5, url: 'https://a.example/', settlementTx: '0x12' }), /settlement/)
})

await Promise.all(pending)
if (failed > 0) {
  console.error(`${failed} x402 test(s) failed`)
  process.exit(1)
}
console.log('x402 tests passed')
