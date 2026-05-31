/**
 * Non-interactive service re-registration script.
 * Updates the on-chain endpoint to a public URL.
 *
 * Usage:
 *   MNEMONIC="word1 word2 ... word25" node register-public.mjs <endpoint-url>
 *
 * Example:
 *   MNEMONIC="abandon abandon ... invest" \
 *   node register-public.mjs https://oral-providence-wrapped-rosa.trycloudflare.com
 */

import { createRequire } from 'module'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const require = createRequire(import.meta.url)
const algosdk = require('algosdk')

const endpoint = process.argv[2]
const mnemonic = process.env.MNEMONIC

if (!endpoint) {
  console.error('Usage: MNEMONIC="..." node register-public.mjs <endpoint-url>')
  process.exit(1)
}
if (!mnemonic) {
  console.error('Error: Set MNEMONIC env var to your 25-word Algorand mnemonic')
  process.exit(1)
}

// Load local config for service metadata
let config
try {
  const raw = await readFile(join(homedir(), '.chainpe', 'config.json'), 'utf-8')
  config = JSON.parse(raw)
} catch {
  console.error('Error: Run "chainpe init" first to set up your service config.')
  process.exit(1)
}

console.log('Service metadata:')
console.log('  Name:        ', config.serviceName)
console.log('  Description: ', config.serviceDescription)
console.log('  Price:       ', config.pricePerRequest, config.paymentToken)
console.log('  Wallet:      ', config.walletAddress)
console.log('  Endpoint:    ', endpoint)
console.log('  Network:     ', config.network ?? 'testnet')
console.log('')

// Derive address from mnemonic and verify it matches
let account
try {
  account = algosdk.mnemonicToSecretKey(mnemonic.trim())
} catch {
  console.error('Error: Invalid mnemonic phrase')
  process.exit(1)
}
const signerAddress = algosdk.encodeAddress(account.addr.publicKey)
console.log('Signer address:', signerAddress)
if (signerAddress !== config.walletAddress) {
  console.warn('Warning: signer address differs from configured wallet address.')
  console.warn('  Configured wallet:', config.walletAddress)
  console.warn('  Signing with:     ', signerAddress)
  console.warn('  The registered developer will be your signer address.')
}
console.log('')

// Connect to Algorand
const network = config.network ?? 'testnet'
const algodUrl = network === 'mainnet'
  ? 'https://mainnet-api.algonode.cloud'
  : 'https://testnet-api.algonode.cloud'
const algod = new algosdk.Algodv2('', algodUrl, '')
const appId = BigInt(config.registryAppId ?? '757478481')

// Check balance
const acctInfo = await algod.accountInformation(account.addr).do()
const algoBalance = Number(acctInfo.amount ?? 0) / 1e6
console.log(`Balance: ${algoBalance.toFixed(4)} ALGO`)
if (algoBalance < 1.5) {
  console.error('Error: Need at least 1.5 ALGO for registration fee + storage')
  console.error('  Fund at: https://bank.testnet.algorand.network/')
  process.exit(1)
}

// Build registration transaction
const sp = await algod.getTransactionParams().do()

// Admin wallet (receives the 1 ALGO registration fee) - read from contract
// We send 1 ALGO to the contract, which routes to admin
const registrationFee = BigInt(1_000_000) // 1 ALGO in microALGO
const adminWallet = 'CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE'

// Encode the register method call (ARC-4)
function encodeArc4String(s) {
  const utf8 = new TextEncoder().encode(s)
  const buf = new Uint8Array(2 + utf8.length)
  new DataView(buf.buffer).setUint16(0, utf8.length, false)
  buf.set(utf8, 2)
  return buf
}

const registerSig = 'register(pay,string,string,string,string,string,string,string,string)void'
const selector = algosdk.ABIMethod.fromSignature(registerSig).getSelector()

// Build payment txn (1 ALGO to contract admin)
const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
  sender: account.addr,
  receiver: adminWallet,
  amount: registrationFee,
  suggestedParams: { ...sp, flatFee: true, fee: 1000 },
})

// Build app call txn
const appArgs = [
  selector,
  encodeArc4String(config.serviceName),
  encodeArc4String(config.serviceDescription),
  encodeArc4String((config.tags ?? []).join(',')),
  encodeArc4String(endpoint),
  encodeArc4String(config.pricePerRequest),
  encodeArc4String(config.paymentToken),
  encodeArc4String(config.walletAddress),
  encodeArc4String(network),
]

const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
  sender: account.addr,
  appIndex: appId,
  appArgs,
  suggestedParams: { ...sp, flatFee: true, fee: 2000 },
})

// Group the transactions
algosdk.assignGroupID([payTxn, appCallTxn])

// Sign both
const signedPay     = payTxn.signTxn(account.sk)
const signedAppCall = appCallTxn.signTxn(account.sk)

console.log('Submitting registration transaction...')
let txResult
try {
  txResult = await algod.sendRawTransaction([signedPay, signedAppCall]).do()
} catch (err) {
  // If already registered, try updateService instead
  if (/app state error\b|already registered\b/i.test(err.message ?? '')) {
    console.log('Service may already exist — attempting update...')
    const updateSig = 'update(string,string,string,string,string,string,string,string)void'
    const updateSelector = algosdk.ABIMethod.fromSignature(updateSig).getSelector()
    const updateArgs = [
      updateSelector,
      encodeArc4String(config.serviceName),
      encodeArc4String(config.serviceDescription),
      encodeArc4String((config.tags ?? []).join(',')),
      encodeArc4String(endpoint),
      encodeArc4String(config.pricePerRequest),
      encodeArc4String(config.paymentToken),
      encodeArc4String(config.walletAddress),
      encodeArc4String(network),
    ]
    const updatePayTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: adminWallet,
      amount: registrationFee,
      suggestedParams: { ...sp, flatFee: true, fee: 1000 },
    })
    const updateAppCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: account.addr,
      appIndex: appId,
      appArgs: updateArgs,
      suggestedParams: { ...sp, flatFee: true, fee: 2000 },
    })
    algosdk.assignGroupID([updatePayTxn, updateAppCallTxn])
    const signedUpdatePay     = updatePayTxn.signTxn(account.sk)
    const signedUpdateAppCall = updateAppCallTxn.signTxn(account.sk)
    txResult = await algod.sendRawTransaction([signedUpdatePay, signedUpdateAppCall]).do()
  } else {
    throw err
  }
}

console.log('')
const txId = txResult.txid ?? txResult
console.log('✓ Transaction submitted:', txId)
console.log('  Waiting for confirmation...')
await algosdk.waitForConfirmation(algod, txId, 10)
console.log('✓ Confirmed on Algorand', network)
console.log('')
console.log('Your service is now discoverable at:', endpoint)
console.log('Explorer: https://testnet.explorer.perawallet.app/tx/' + txId)
