#!/usr/bin/env node

// src/cli.ts
import { program } from "commander";
import * as p from "@clack/prompts";
import chalk3 from "chalk";
import gradient from "gradient-string";
import ora from "ora";
import fs3 from "fs/promises";
import path3 from "path";
import os3 from "os";
import algosdk6 from "algosdk";

// src/facilitator/algorand-client.ts
import { HTTPFacilitatorClient } from "@x402-avm/core/server";

// src/types.ts
var ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
var ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
var USDC_TESTNET_ASA_ID = 10458941;
var USDC_MAINNET_ASA_ID = 31566704;
var USDC_DECIMALS = 6;
var ALGO_DECIMALS = 6;
var ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
var ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";

// src/facilitator/algorand-client.ts
import algosdk from "algosdk";
function createAlgodClient(network) {
  const url = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
  return new algosdk.Algodv2("", url, "");
}
function isValidAlgorandAddress(address) {
  if (!address || address.length !== 58) {
    return false;
  }
  try {
    algosdk.decodeAddress(address);
    return true;
  } catch {
    return false;
  }
}
async function getAccountInfo(algod, address) {
  const info = await algod.accountInformation(address).do();
  return {
    balance: info.amount,
    minBalance: info.minBalance,
    assets: (info.assets || []).map((a) => ({
      assetId: a.assetId,
      amount: a.amount
    }))
  };
}
function formatAlgo(microAlgos, decimals = 6) {
  const divisor = BigInt(10 ** decimals);
  const whole = microAlgos / divisor;
  const fraction = microAlgos % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmedFraction = fractionStr.replace(/0+$/, "");
  return `${whole}.${trimmedFraction}`;
}

// src/proxy/server.ts
import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import { paymentMiddleware } from "@x402-avm/express";
import { x402ResourceServer } from "@x402-avm/core/server";
import { ExactAvmScheme } from "@x402-avm/avm/exact/server";

// src/x402/algo/server-scheme.ts
var AlgoNativeServerScheme = class {
  scheme = "algo-exact";
  /**
   * Parse a price into microALGO amount
   * 
   * The price from routes config is already in microALGO (Money type).
   * We just need to wrap it in an AssetAmount structure.
   * 
   * @param price - Price in microALGO (Money type string/number) or AssetAmount
   * @param network - Network identifier (unused, ALGO is same on all networks)
   * @returns Asset amount with microALGO
   */
  async parsePrice(price, network) {
    void network;
    let amount;
    if (typeof price === "string" || typeof price === "number") {
      amount = String(price);
    } else {
      if (price.asset !== "ALGO") {
        throw new Error(`Invalid asset for algo-exact scheme: ${price.asset}`);
      }
      amount = price.amount;
    }
    return {
      amount,
      asset: "ALGO",
      extra: {
        decimals: ALGO_DECIMALS,
        tokenName: "ALGO"
      }
    };
  }
  /**
   * Enhance payment requirements with scheme-specific data
   * 
   * @param paymentRequirements - Base requirements
   * @param supportedKind - Supported kind from facilitator
   * @param facilitatorExtensions - Extensions supported by facilitator
   * @returns Enhanced payment requirements
   */
  async enhancePaymentRequirements(paymentRequirements, supportedKind, facilitatorExtensions) {
    void facilitatorExtensions;
    const enhanced = {
      ...paymentRequirements,
      extra: {
        ...paymentRequirements.extra,
        decimals: ALGO_DECIMALS,
        tokenName: "ALGO",
        ...supportedKind.extra?.feePayer ? { feePayer: supportedKind.extra.feePayer } : {}
      }
    };
    return enhanced;
  }
  /**
   * Convert user-friendly amount to microALGO
   * 
   * @param price - Price as string or number (e.g., "0.01" or 0.01)
   * @returns Amount in microALGO as string
   */
  convertToMicroAlgo(price) {
    const priceStr = typeof price === "number" ? price.toString() : price;
    const cleanPrice = priceStr.replace(/^\$/, "").trim();
    const amount = parseFloat(cleanPrice);
    if (isNaN(amount) || amount < 0) {
      throw new Error(`Invalid ALGO price: ${price}`);
    }
    const parts = cleanPrice.split(".");
    const whole = BigInt(parts[0] || "0");
    const fractionStr = (parts[1] || "").padEnd(ALGO_DECIMALS, "0").slice(0, ALGO_DECIMALS);
    const fraction = BigInt(fractionStr);
    const microAlgo = whole * BigInt(10 ** ALGO_DECIMALS) + fraction;
    return microAlgo.toString();
  }
};

// src/facilitator/local-facilitator-client.ts
import { x402Facilitator } from "@x402-avm/core/facilitator";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/facilitator";
import { toFacilitatorAvmSigner } from "@x402-avm/avm";
import { mnemonicToSecretKey } from "algosdk";
function mnemonicToBase64PrivateKey(mnemonic) {
  const account = mnemonicToSecretKey(mnemonic);
  return Buffer.from(account.sk).toString("base64");
}
var LocalFacilitatorClient = class {
  facilitator;
  networks;
  /**
   * Creates a new LocalFacilitatorClient
   * 
   * @param mnemonic - 25-word Algorand mnemonic for signing fee-payer transactions
   * @param network - "testnet" or "mainnet"
   */
  constructor(mnemonic, network = "testnet") {
    this.facilitator = new x402Facilitator();
    const networkCaip2 = network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
    this.networks = [networkCaip2];
    const privateKeyBase64 = mnemonicToBase64PrivateKey(mnemonic);
    const signer = toFacilitatorAvmSigner(privateKeyBase64);
    registerExactAvmScheme(this.facilitator, {
      signer,
      networks: this.networks
    });
  }
  /**
   * Get supported payment kinds
   */
  async getSupported() {
    return this.facilitator.getSupported();
  }
  /**
   * Verify a payment payload
   */
  async verify(payload, requirements) {
    return this.facilitator.verify(payload, requirements);
  }
  /**
   * Settle a payment
   */
  async settle(payload, requirements) {
    return this.facilitator.settle(payload, requirements);
  }
};
function createLocalFacilitator(mnemonic, network = "testnet") {
  return new LocalFacilitatorClient(mnemonic, network);
}

// src/facilitator/simple-verifier.ts
import algosdk2 from "algosdk";
var SimplePaymentVerifier = class {
  algod;
  network;
  walletAddress;
  constructor(walletAddress, network = "testnet") {
    this.walletAddress = walletAddress;
    this.network = network;
    this.algod = createAlgodClient(network);
  }
  get networkCaip2() {
    return this.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
  }
  get usdcAsaId() {
    return BigInt(this.network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID);
  }
  /**
   * Get supported payment kinds in the shape the x402 route validator expects.
   * Each kind: { x402Version: 2, scheme, network }. No feePayer advertised, so
   * the client fully signs and self-pays the network fee.
   */
  async getSupported() {
    const networkCaip2 = this.networkCaip2;
    const schemes = ["exact", "algo-exact"];
    return {
      kinds: schemes.map((scheme) => ({
        x402Version: 2,
        scheme,
        network: networkCaip2
      })),
      extensions: [],
      signers: {}
    };
  }
  /**
   * Verify the client-signed payment transaction WITHOUT requiring it to be
   * on-chain yet (it is broadcast in settle()).
   */
  async verify(payload, requirements) {
    try {
      const decoded = this.decodePayment(payload);
      if (!decoded) {
        return { isValid: false, invalidReason: "Could not decode signed payment transaction" };
      }
      const check = this.validate(decoded, requirements);
      if (!check.valid) {
        return { isValid: false, invalidReason: check.reason };
      }
      return { isValid: true, payer: decoded.payer };
    } catch (error) {
      return { isValid: false, invalidReason: `Verification error: ${error.message}` };
    }
  }
  /**
   * Settle by broadcasting the already-signed transaction group to Algorand.
   */
  async settle(payload, requirements) {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        transaction: "",
        network: this.networkCaip2,
        errorMessage: verifyResult.invalidReason
      };
    }
    try {
      const group = this.extractGroup(payload);
      if (!group) {
        return {
          success: false,
          transaction: "",
          network: this.networkCaip2,
          errorMessage: "No payment transaction group found in payload"
        };
      }
      const blobs = group.entries.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
      const paymentTxId = algosdk2.decodeSignedTransaction(blobs[group.index]).txn.txID();
      try {
        await this.algod.sendRawTransaction(blobs).do();
      } catch (err) {
        const msg = err.message || "";
        if (!/already in ledger|transaction already|already committed/i.test(msg)) {
          throw err;
        }
      }
      await algosdk2.waitForConfirmation(this.algod, paymentTxId, 10);
      return {
        success: true,
        transaction: paymentTxId,
        network: this.networkCaip2
      };
    } catch (error) {
      return {
        success: false,
        transaction: "",
        network: this.networkCaip2,
        errorMessage: `Settlement (broadcast) failed: ${error.message}`
      };
    }
  }
  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------
  /**
   * Pulls the AVM payment group ({ paymentGroup, paymentIndex }) out of the
   * payload, handling both the wrapped PaymentPayload and the inner shape.
   */
  extractGroup(payload) {
    const candidates = [payload?.payload, payload];
    for (const c of candidates) {
      if (c && Array.isArray(c.paymentGroup) && c.paymentGroup.length > 0) {
        return { entries: c.paymentGroup, index: Number(c.paymentIndex ?? 0) };
      }
    }
    return null;
  }
  /**
   * Decodes the signed payment transaction (at paymentIndex) into its key fields.
   */
  decodePayment(payload) {
    const group = this.extractGroup(payload);
    if (!group) return null;
    const entry = group.entries[group.index] ?? group.entries[0];
    const bytes = new Uint8Array(Buffer.from(entry, "base64"));
    const stxn = algosdk2.decodeSignedTransaction(bytes);
    const txn = stxn.txn;
    const payer = txn.sender ? txn.sender.toString() : "unknown";
    let receiver;
    let amount = 0n;
    let assetId;
    if (txn.type === "axfer" && txn.assetTransfer) {
      receiver = txn.assetTransfer.receiver?.toString();
      amount = BigInt(txn.assetTransfer.amount ?? 0);
      assetId = BigInt(txn.assetTransfer.assetIndex ?? 0);
    } else if (txn.type === "pay" && txn.payment) {
      receiver = txn.payment.receiver?.toString();
      amount = BigInt(txn.payment.amount ?? 0);
    }
    return { payer, receiver, amount, assetId, type: txn.type, txId: txn.txID() };
  }
  /**
   * Validates the decoded payment against the route requirements.
   */
  validate(decoded, requirements) {
    const expectedPayTo = requirements?.payTo || this.walletAddress;
    if (decoded.receiver !== expectedPayTo) {
      return {
        valid: false,
        reason: `Payment receiver ${decoded.receiver} does not match expected ${expectedPayTo}`
      };
    }
    const requiredRaw = requirements?.maxAmountRequired ?? requirements?.amount ?? requirements?.maxAmount;
    if (requiredRaw !== void 0 && requiredRaw !== null) {
      let required;
      try {
        required = BigInt(requiredRaw);
      } catch {
        required = 0n;
      }
      if (decoded.amount < required) {
        return { valid: false, reason: `Paid ${decoded.amount}, required ${required}` };
      }
    }
    if (decoded.type === "axfer") {
      const expectedAsset = this.assetIdFromRequirements(requirements);
      if (expectedAsset !== void 0 && decoded.assetId !== expectedAsset) {
        return {
          valid: false,
          reason: `Wrong asset: paid asset ${decoded.assetId}, expected ${expectedAsset}`
        };
      }
    }
    return { valid: true };
  }
  assetIdFromRequirements(requirements) {
    const candidate = requirements?.extra?.assetId ?? (typeof requirements?.asset === "string" && /^\d+$/.test(requirements.asset) ? requirements.asset : void 0);
    if (candidate === void 0 || candidate === null) {
      return this.usdcAsaId;
    }
    try {
      return BigInt(candidate);
    } catch {
      return this.usdcAsaId;
    }
  }
};
function createSimpleVerifier(walletAddress, network = "testnet") {
  return new SimplePaymentVerifier(walletAddress, network);
}

// src/facilitator/algo-facilitator.ts
import algosdk3 from "algosdk";
var AlgoNativeFacilitator = class {
  algod;
  indexer;
  network;
  walletAddress;
  constructor(walletAddress, network = "testnet") {
    this.walletAddress = walletAddress;
    this.network = network;
    this.algod = createAlgodClient(network);
    this.indexer = new algosdk3.Indexer(
      "",
      network === "testnet" ? "https://testnet-idx.algonode.cloud" : "https://mainnet-idx.algonode.cloud",
      ""
    );
  }
  /**
   * Get supported payment kinds (x402 v2 format)
   */
  async getSupported() {
    const networkCaip2 = this.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "algo-exact",
          network: networkCaip2,
          extra: {
            decimals: ALGO_DECIMALS,
            tokenName: "ALGO"
          }
        }
      ],
      extensions: [],
      signers: {}
    };
  }
  /**
   * Verify a payment by decoding and validating the signed transaction
   */
  async verify(payload, requirements) {
    try {
      const algoPayload = this.extractAlgoPayload(payload);
      if (!algoPayload) {
        return {
          isValid: false,
          invalidReason: "Invalid payload format for algo-exact scheme"
        };
      }
      const { paymentGroup, paymentIndex } = algoPayload;
      if (!Array.isArray(paymentGroup) || paymentGroup.length === 0) {
        return {
          isValid: false,
          invalidReason: "Payment group is empty or invalid"
        };
      }
      if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
        return {
          isValid: false,
          invalidReason: `Invalid payment index: ${paymentIndex}`
        };
      }
      const paymentTxnBase64 = paymentGroup[paymentIndex];
      const signedTxnBytes = Buffer.from(paymentTxnBase64, "base64");
      const signedTxn = algosdk3.decodeSignedTransaction(signedTxnBytes);
      if (!signedTxn.sig && !signedTxn.msig && !signedTxn.lsig) {
        return {
          isValid: false,
          invalidReason: "Transaction is not signed"
        };
      }
      const txn = signedTxn.txn;
      if (txn.type !== algosdk3.TransactionType.pay) {
        return {
          isValid: false,
          invalidReason: `Expected payment transaction, got ${txn.type}`
        };
      }
      if (!txn.payment) {
        return {
          isValid: false,
          invalidReason: "Transaction missing payment fields"
        };
      }
      const receiver = txn.payment.receiver.toString();
      if (receiver !== requirements.payTo) {
        return {
          isValid: false,
          invalidReason: `Payment receiver ${receiver} does not match required ${requirements.payTo}`
        };
      }
      const paidAmount = txn.payment.amount;
      const requiredAmount = BigInt(requirements.amount);
      if (paidAmount < requiredAmount) {
        return {
          isValid: false,
          invalidReason: `Insufficient payment: ${paidAmount} < ${requiredAmount} microALGO`
        };
      }
      const txnGenesisHash = txn.genesisHash ? Buffer.from(txn.genesisHash).toString("base64") : "";
      const expectedGenesisHash = this.network === "testnet" ? "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=" : "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
      if (txnGenesisHash !== expectedGenesisHash) {
        return {
          isValid: false,
          invalidReason: `Transaction is for wrong network (genesis hash mismatch)`
        };
      }
      const payer = txn.sender.toString();
      return {
        isValid: true,
        payer
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `Verification error: ${error.message}`
      };
    }
  }
  /**
   * Settle a payment by broadcasting it to the Algorand network
   */
  async settle(payload, requirements) {
    const networkCaip2 = this.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
    try {
      const verifyResult = await this.verify(payload, requirements);
      if (!verifyResult.isValid) {
        return {
          success: false,
          errorReason: "verification_failed",
          errorMessage: verifyResult.invalidReason,
          transaction: "",
          network: networkCaip2
        };
      }
      const algoPayload = this.extractAlgoPayload(payload);
      if (!algoPayload) {
        return {
          success: false,
          errorReason: "invalid_payload",
          errorMessage: "Could not extract payment group",
          transaction: "",
          network: networkCaip2
        };
      }
      const signedTxns = algoPayload.paymentGroup.map(
        (base64Txn) => Buffer.from(base64Txn, "base64")
      );
      const response = await this.algod.sendRawTransaction(signedTxns).do();
      const txId = response.txid;
      try {
        await algosdk3.waitForConfirmation(this.algod, txId, 4);
      } catch (confirmError) {
        console.warn(`Transaction ${txId} broadcast but confirmation timed out:`, confirmError);
      }
      return {
        success: true,
        transaction: txId,
        network: networkCaip2,
        payer: verifyResult.payer
      };
    } catch (error) {
      return {
        success: false,
        errorReason: "broadcast_failed",
        errorMessage: `Failed to broadcast transaction: ${error.message}`,
        transaction: "",
        network: networkCaip2
      };
    }
  }
  /**
   * Extract AlgoExactPayload from generic PaymentPayload
   */
  extractAlgoPayload(payload) {
    try {
      const rawPayload = payload.payload;
      if (!rawPayload || typeof rawPayload !== "object") {
        return null;
      }
      const { paymentGroup, paymentIndex } = rawPayload;
      if (!paymentGroup || !Array.isArray(paymentGroup)) {
        return null;
      }
      if (typeof paymentIndex !== "number") {
        return null;
      }
      return { paymentGroup, paymentIndex };
    } catch {
      return null;
    }
  }
};
function createAlgoNativeFacilitator(walletAddress, network = "testnet") {
  return new AlgoNativeFacilitator(walletAddress, network);
}

// src/proxy/routeConfig.ts
function parseAmount2(amount, decimals = 6) {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fractionStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const fraction = BigInt(fractionStr);
  return (whole * BigInt(10 ** decimals) + fraction).toString();
}
function getPrice(amount, token, network) {
  const decimals = token === "USDC" ? USDC_DECIMALS : ALGO_DECIMALS;
  const amountInMicrounits = parseAmount2(amount, decimals);
  if (token === "ALGO") {
    return amountInMicrounits;
  }
  const asaId = network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID;
  return {
    asset: String(asaId),
    amount: amountInMicrounits,
    extra: {
      name: "USDC",
      assetId: asaId,
      decimals
    }
  };
}
function createRoutesConfig(config, additionalRoutes) {
  const routes = {};
  const buildRoute = (priceStr, tokenStr, description) => {
    const network = config.network;
    const networkId = network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
    const priceValue = getPrice(priceStr, tokenStr, network);
    const asaId = tokenStr === "USDC" ? network === "testnet" ? USDC_TESTNET_ASA_ID : USDC_MAINNET_ASA_ID : void 0;
    const scheme = tokenStr === "ALGO" ? "algo-exact" : "exact";
    return {
      accepts: {
        scheme,
        payTo: config.walletAddress,
        price: priceValue,
        network: networkId,
        maxTimeoutSeconds: 300,
        ...tokenStr === "USDC" && asaId ? {
          extra: {
            assetId: asaId,
            assetDecimals: USDC_DECIMALS
          }
        } : {}
      },
      description: description || `Pay ${priceStr} ${tokenStr} per request`,
      resource: config.targetUrl,
      mimeType: "application/json"
    };
  };
  if (additionalRoutes) {
    for (const route of additionalRoutes) {
      routes[route.path] = buildRoute(
        route.pricePerRequest || config.pricePerRequest,
        route.paymentToken || config.paymentToken,
        route.description
      );
    }
  }
  routes["/*"] = buildRoute(config.pricePerRequest, config.paymentToken);
  return routes;
}
function formatRoutesForDisplay(routes) {
  if (!routes || typeof routes !== "object") {
    return [];
  }
  if ("accepts" in routes) {
    return [];
  }
  const routesMap = routes;
  return Object.entries(routesMap).map(([path4, config]) => {
    const accepts = config.accepts;
    const option = Array.isArray(accepts) ? accepts[0] : accepts;
    let amount;
    let decimals;
    let token;
    const price = option.price;
    if (typeof price === "string" || typeof price === "number") {
      amount = String(price);
      decimals = ALGO_DECIMALS;
      token = "ALGO";
    } else if (price && typeof price === "object" && "amount" in price) {
      const assetPrice = price;
      amount = assetPrice.amount;
      decimals = assetPrice.extra?.decimals || USDC_DECIMALS;
      token = assetPrice.asset || "USDC";
    } else {
      amount = "0";
      decimals = ALGO_DECIMALS;
      token = "ALGO";
    }
    const amountBigInt = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const whole = amountBigInt / divisor;
    const fraction = amountBigInt % divisor;
    const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
    const priceStr = fractionStr ? `${whole}.${fractionStr}` : whole.toString();
    return { path: path4, price: priceStr, token, decimals };
  });
}

// src/proxy/analytics.ts
var MAX_RECENT_PAYMENTS = 100;
var Analytics = class {
  stats;
  recentPayments;
  minuteRequests;
  currentMinute;
  constructor() {
    this.stats = {
      totalRequests: 0,
      paidRequests: 0,
      failedPayments: 0,
      totalRevenue: 0n,
      revenueByToken: {
        ALGO: 0n,
        USDC: 0n
      },
      requestsPerMinute: [],
      lastHourRequests: 0
    };
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
    this.currentMinute = (/* @__PURE__ */ new Date()).getMinutes();
  }
  /**
   * Records a request (paid or unpaid)
   */
  recordRequest() {
    this.stats.totalRequests++;
    this.updateMinuteStats();
  }
  /**
   * Records a successful payment
   */
  recordPayment(event) {
    if (event.success) {
      this.stats.paidRequests++;
      const amount = BigInt(event.amount);
      this.stats.totalRevenue += amount;
      this.stats.revenueByToken[event.token] = (this.stats.revenueByToken[event.token] || 0n) + amount;
    } else {
      this.stats.failedPayments++;
    }
    this.recentPayments.unshift(event);
    if (this.recentPayments.length > MAX_RECENT_PAYMENTS) {
      this.recentPayments.pop();
    }
  }
  /**
   * Updates per-minute request tracking
   */
  updateMinuteStats() {
    const now = /* @__PURE__ */ new Date();
    const minute = now.getMinutes();
    if (minute !== this.currentMinute) {
      const diff = (minute - this.currentMinute + 60) % 60;
      for (let i = 1; i <= diff; i++) {
        const clearMinute = (this.currentMinute + i) % 60;
        this.minuteRequests[clearMinute] = 0;
      }
      this.currentMinute = minute;
    }
    this.minuteRequests[minute]++;
    this.stats.lastHourRequests = this.minuteRequests.reduce((a, b) => a + b, 0);
    this.stats.requestsPerMinute = [...this.minuteRequests];
  }
  /**
   * Gets current statistics
   */
  getStats() {
    return { ...this.stats };
  }
  /**
   * Gets recent payment events
   */
  getRecentPayments() {
    return [...this.recentPayments];
  }
  /**
   * Gets formatted revenue summary
   */
  getRevenueSummary() {
    const format = (amount, decimals) => {
      const divisor = BigInt(10 ** decimals);
      const whole = amount / divisor;
      const fraction = amount % divisor;
      if (fraction === 0n) {
        return whole.toString();
      }
      const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
      return `${whole}.${fractionStr}`;
    };
    return {
      ALGO: format(this.stats.revenueByToken.ALGO || 0n, 6),
      USDC: format(this.stats.revenueByToken.USDC || 0n, 6)
    };
  }
  /**
   * Resets all statistics
   */
  reset() {
    this.stats = {
      totalRequests: 0,
      paidRequests: 0,
      failedPayments: 0,
      totalRevenue: 0n,
      revenueByToken: {
        ALGO: 0n,
        USDC: 0n
      },
      requestsPerMinute: [],
      lastHourRequests: 0
    };
    this.recentPayments = [];
    this.minuteRequests = new Array(60).fill(0);
  }
};
var analytics = new Analytics();

// src/logger.ts
import chalk from "chalk";
var currentLogLevel = "normal";
function setLogLevel(level) {
  currentLogLevel = level;
}
var icons = {
  info: chalk.blue("\u25CF"),
  success: chalk.green("\u2713"),
  warn: chalk.yellow("\u26A0"),
  error: chalk.red("\u2717"),
  verbose: chalk.gray("\u25CB"),
  payment: chalk.green("$"),
  request: chalk.cyan("\u2192"),
  server: chalk.magenta("\u25C6")
};
var timestamp = () => {
  const now = /* @__PURE__ */ new Date();
  return chalk.gray(
    `[${now.toLocaleTimeString("en-US", { hour12: false })}]`
  );
};
var logger = {
  verbose: (message, ...args) => {
    if (currentLogLevel === "verbose") {
      console.log(`${timestamp()} ${icons.verbose} ${chalk.gray(message)}`, ...args);
    }
  },
  info: (message, ...args) => {
    if (currentLogLevel !== "quiet") {
      console.log(`${timestamp()} ${icons.info} ${message}`, ...args);
    }
  },
  success: (message, ...args) => {
    if (currentLogLevel !== "quiet") {
      console.log(`${timestamp()} ${icons.success} ${chalk.green(message)}`, ...args);
    }
  },
  warn: (message, ...args) => {
    console.log(`${timestamp()} ${icons.warn} ${chalk.yellow(message)}`, ...args);
  },
  error: (message, ...args) => {
    console.error(`${timestamp()} ${icons.error} ${chalk.red(message)}`, ...args);
  }
};
var logPayment = (amount, token, payer, path4) => {
  if (currentLogLevel !== "quiet") {
    console.log(
      `${timestamp()} ${icons.payment} ${chalk.green.bold(`+${amount} ${token}`)} from ${chalk.cyan(payer.slice(0, 8))}...${chalk.cyan(payer.slice(-4))} \u2192 ${chalk.white(path4)}`
    );
  }
};
var logRequest = (method, path4, status, duration) => {
  if (currentLogLevel === "verbose") {
    const statusColor = status >= 500 ? chalk.red : status >= 400 ? chalk.yellow : status >= 300 ? chalk.cyan : chalk.green;
    console.log(
      `${timestamp()} ${icons.request} ${chalk.white.bold(method)} ${path4} ${statusColor(status)} ${chalk.gray(`${duration}ms`)}`
    );
  }
};
var logServerStart = (port, serviceName) => {
  console.log();
  console.log(
    `${timestamp()} ${icons.server} ${chalk.magenta.bold("ChainPe")} proxy started`
  );
  console.log(
    `${chalk.gray("   ")}${icons.info} Service: ${chalk.white.bold(serviceName)}`
  );
  console.log(
    `${chalk.gray("   ")}${icons.info} Listening on: ${chalk.cyan.bold(`http://localhost:${port}`)}`
  );
  console.log();
};

// src/proxy/server.ts
function createProxyServer(options) {
  const { config, additionalRoutes, onPayment, facilitatorMnemonic } = options;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => {
    const start = Date.now();
    analytics.recordRequest();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logRequest(req.method, req.path, res.statusCode, duration);
    });
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: config.serviceName,
      uptime: process.uptime()
    });
  });
  const adminRouter = express.Router();
  if (config.adminKey) {
    adminRouter.use((req, res, next) => {
      const apiKey = req.headers["x-admin-key"] || req.query.adminKey;
      if (apiKey !== config.adminKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }
  adminRouter.get("/stats", (_req, res) => {
    const stats = analytics.getStats();
    const revenue = analytics.getRevenueSummary();
    res.json({
      ...stats,
      revenue,
      totalRevenue: void 0,
      // Remove bigint (not JSON serializable)
      revenueByToken: void 0
    });
  });
  adminRouter.get("/payments", (_req, res) => {
    res.json(analytics.getRecentPayments());
  });
  adminRouter.get("/config", (_req, res) => {
    res.json({
      serviceName: config.serviceName,
      serviceDescription: config.serviceDescription,
      targetUrl: config.targetUrl,
      pricePerRequest: config.pricePerRequest,
      paymentToken: config.paymentToken,
      walletAddress: config.walletAddress,
      network: config.network,
      tags: config.tags
    });
  });
  app.use("/chainpe-admin", adminRouter);
  const networkCaip2 = config.network === "testnet" ? ALGORAND_TESTNET_CAIP2 : ALGORAND_MAINNET_CAIP2;
  let facilitator;
  if (config.paymentToken === "ALGO") {
    logger.info("Using ALGO native facilitator (native payment transactions)");
    facilitator = createAlgoNativeFacilitator(config.walletAddress, config.network);
  } else if (facilitatorMnemonic) {
    logger.info("Using local facilitator (in-process payment verification with signing)");
    facilitator = createLocalFacilitator(facilitatorMnemonic, config.network);
  } else {
    logger.info("Using simple verifier (blockchain-based payment verification)");
    facilitator = createSimpleVerifier(config.walletAddress, config.network);
  }
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(networkCaip2, new AlgoNativeServerScheme());
  resourceServer.register(networkCaip2, new ExactAvmScheme());
  const routesConfig = createRoutesConfig(config, additionalRoutes);
  logger.info("Configured routes for x402 payment:");
  for (const route of formatRoutesForDisplay(routesConfig)) {
    logger.info(`  ${route.path} \u2192 ${route.price} ${route.token}`);
  }
  const paywallConfig = {
    appName: config.serviceName,
    testnet: config.network === "testnet"
  };
  app.use(paymentMiddleware(routesConfig, resourceServer, paywallConfig));
  app.use((req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = function(body) {
      const paymentReceipt = res.getHeader("X-Payment-Receipt");
      if (paymentReceipt) {
        try {
          const receipt = JSON.parse(paymentReceipt);
          const event = {
            timestamp: /* @__PURE__ */ new Date(),
            path: req.path,
            amount: receipt.amount || config.pricePerRequest,
            token: config.paymentToken,
            payer: receipt.payer || "unknown",
            txId: receipt.transaction,
            success: true
          };
          analytics.recordPayment(event);
          logPayment(event.amount, event.token, event.payer, event.path);
          if (onPayment) {
            onPayment(event);
          }
        } catch {
        }
      }
      return originalSend(body);
    };
    next();
  });
  const proxyOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq, req) => {
        if (req.headers["content-type"]) {
          proxyReq.setHeader("Content-Type", req.headers["content-type"]);
        }
        logger.verbose(`Proxying ${req.method} ${req.url} \u2192 ${config.targetUrl}`);
      },
      proxyRes: (proxyRes, req) => {
        logger.verbose(
          `Response from ${config.targetUrl}${req.url}: ${proxyRes.statusCode}`
        );
      },
      error: (err, _req, res) => {
        logger.error(`Proxy error: ${err.message}`);
        if (res && "writeHead" in res && typeof res.writeHead === "function") {
          res.status(502).json({
            error: "Bad Gateway",
            message: "Failed to reach upstream server"
          });
        }
      }
    }
  };
  app.use("/", createProxyMiddleware(proxyOptions));
  return app;
}
async function startProxyServer(options) {
  const { config } = options;
  const app = createProxyServer(options);
  return new Promise((resolve) => {
    const server = app.listen(config.proxyPort, () => {
      logServerStart(config.proxyPort, config.serviceName);
      resolve({ app, server });
    });
  });
}

// src/registry.ts
import algosdk4 from "algosdk";
import fs from "fs";
import path from "path";
import os from "os";
var DEFAULT_ADMIN_ADDRESS = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
var ADMIN_ADDRESS = process.env.CHAINPE_ADMIN_ADDRESS || DEFAULT_ADMIN_ADDRESS;
var REGISTRATION_FEE = 1000000n;
function formatAlgoFromMicro(micro) {
  return (Number(micro) / 1e6).toFixed(6);
}
var DEFAULT_APP_ID = 757478481n;
function readAppIdFromConfig() {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const data = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(data);
    if (config.registryAppId) {
      return BigInt(config.registryAppId);
    }
  } catch {
  }
  return void 0;
}
function getRegistryAppId() {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) {
    return BigInt(envId);
  }
  const configId = readAppIdFromConfig();
  if (configId) {
    return configId;
  }
  return DEFAULT_APP_ID;
}
var REGISTER_SIG = "register(pay,string,string,string,string,string,string,string,string)void";
var UPDATE_SIG = "update(pay,string,string,string,string,string,string,string,string)void";
var GET_SERVICE_SIG = "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)";
var ARC4_RETURN_PREFIX = new Uint8Array([21, 31, 124, 117]);
function methodSelector(signature) {
  return algosdk4.ABIMethod.fromSignature(signature).getSelector();
}
function encodeArc4String(s) {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}
function buildAppArgs(selector, ...strings) {
  return [selector, ...strings.map(encodeArc4String)];
}
function buildGetServiceArgs(selector, developerAddress, serviceName) {
  const addrBytes = algosdk4.decodeAddress(developerAddress).publicKey;
  const encodedName = encodeArc4String(serviceName);
  return [selector, addrBytes, encodedName];
}
function decodeServiceData(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false));
  const developer = algosdk4.encodeAddress(data.slice(16, 48));
  const createdAt = Number(view.getBigUint64(48, false));
  const updatedAt = Number(view.getBigUint64(56, false));
  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false);
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len));
  });
  const [name, description, tagsStr, endpoint, pricePerRequest, paymentToken, walletAddress, network] = strings;
  return {
    name,
    description,
    tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken,
    walletAddress,
    network,
    developer,
    createdAt,
    updatedAt
  };
}
function buildBoxKey(senderAddr, serviceName) {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk4.decodeAddress(senderAddr).publicKey;
  const colon = new TextEncoder().encode(":");
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
  let pos = 0;
  key.set(prefix, pos);
  pos += prefix.length;
  key.set(senderBytes, pos);
  pos += senderBytes.length;
  key.set(colon, pos);
  pos += colon.length;
  key.set(nameBytes, pos);
  return key;
}
var ChainPeRegistryClient = class {
  algod;
  appId;
  appAddress;
  constructor(network = "testnet") {
    this.algod = createAlgodClient(network);
    this.appId = getRegistryAppId();
    this.appAddress = algosdk4.getApplicationAddress(this.appId).toString();
  }
  /**
   * Registers (or updates) a service on-chain.
   *
   * Step 1: Fund the app address with enough ALGO to cover box MBR (standalone tx).
   * Step 2: Atomic group:
   *   [0] PaymentTxn  → ADMIN (1 ALGO registration fee) — this is `payTx`
   *   [1] AppCallTxn  → register() or update()
   */
  async registerService(params) {
    const { mnemonic, isUpdate = false, ...service } = params;
    const account = algosdk4.mnemonicToSecretKey(mnemonic);
    const senderAddr = account.addr.toString();
    const sp = await this.algod.getTransactionParams().do();
    const nameBytes = new TextEncoder().encode(service.name);
    const boxKeySize = 4 + 32 + 1 + nameBytes.length;
    const boxValueSize = 1024;
    const boxMbr = BigInt(2500 + 400 * (boxKeySize + boxValueSize));
    const senderInfo = await this.algod.accountInformation(senderAddr).do();
    const senderBalance = BigInt(senderInfo.amount ?? 0);
    const minFee = BigInt(sp.minFee ?? 1e3);
    const estimatedFees = isUpdate ? minFee + 2000n : minFee + minFee + 2000n;
    const totalRequired = (isUpdate ? 0n : boxMbr) + REGISTRATION_FEE + estimatedFees;
    if (senderBalance < totalRequired) {
      const shortfall = totalRequired - senderBalance;
      throw new Error(
        `Insufficient ALGO for registration. Need ${formatAlgoFromMicro(totalRequired)} ALGO (fee to admin ${formatAlgoFromMicro(REGISTRATION_FEE)} + storage ${formatAlgoFromMicro(isUpdate ? 0n : boxMbr)} + tx fees ${formatAlgoFromMicro(estimatedFees)}), have ${formatAlgoFromMicro(senderBalance)} ALGO, short by ${formatAlgoFromMicro(shortfall)} ALGO.`
      );
    }
    if (!isUpdate) {
      const fundTx = algosdk4.makePaymentTxnWithSuggestedParamsFromObject({
        sender: senderAddr,
        receiver: this.appAddress,
        amount: boxMbr,
        suggestedParams: { ...sp }
      });
      const signedFund = fundTx.signTxn(account.sk);
      const { txid: fundTxid } = await this.algod.sendRawTransaction([signedFund]).do();
      await algosdk4.waitForConfirmation(this.algod, fundTxid, 8);
      Object.assign(sp, await this.algod.getTransactionParams().do());
    }
    const sig = isUpdate ? UPDATE_SIG : REGISTER_SIG;
    const selector = methodSelector(sig);
    const appArgs = buildAppArgs(
      selector,
      service.name,
      service.description,
      service.tags.join(", "),
      service.endpoint,
      service.pricePerRequest,
      service.paymentToken,
      service.walletAddress,
      service.network
    );
    const boxKey = buildBoxKey(senderAddr, service.name);
    const payAdminTx = algosdk4.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddr,
      receiver: ADMIN_ADDRESS,
      amount: REGISTRATION_FEE,
      suggestedParams: { ...sp }
    });
    const appCallTx = algosdk4.makeApplicationNoOpTxnFromObject({
      sender: senderAddr,
      appIndex: this.appId,
      appArgs,
      boxes: [{ appIndex: this.appId, name: boxKey }],
      suggestedParams: { ...sp, fee: 2000n, flatFee: true }
    });
    algosdk4.assignGroupID([payAdminTx, appCallTx]);
    const signedTxns = [payAdminTx, appCallTx].map(
      (tx) => tx.signTxn(account.sk)
    );
    const { txid } = await this.algod.sendRawTransaction(signedTxns).do();
    await algosdk4.waitForConfirmation(this.algod, txid, 8);
    return {
      txnHash: txid,
      appId: this.appId,
      appAddress: this.appAddress
    };
  }
  /**
   * Fetches a service from on-chain using algod simulate (read-only, no fee).
   * Returns null if the service does not exist.
   */
  async getService(developerAddress, serviceName) {
    try {
      const selector = methodSelector(GET_SERVICE_SIG);
      const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName);
      const boxKey = buildBoxKey(developerAddress, serviceName);
      const sp = await this.algod.getTransactionParams().do();
      const dryrunTx = algosdk4.makeApplicationNoOpTxnFromObject({
        sender: developerAddress,
        appIndex: this.appId,
        appArgs,
        boxes: [{ appIndex: this.appId, name: boxKey }],
        suggestedParams: sp
      });
      const encodedTxn = algosdk4.encodeUnsignedSimulateTransaction(dryrunTx);
      const signedTxn = algosdk4.decodeSignedTransaction(encodedTxn);
      const request = new algosdk4.modelsv2.SimulateRequest({
        txnGroups: [
          new algosdk4.modelsv2.SimulateRequestTransactionGroup({
            txns: [signedTxn]
          })
        ],
        allowEmptySignatures: true,
        allowUnnamedResources: true,
        allowMoreLogging: true
      });
      const result = await this.algod.simulateTransactions(request).do();
      const txnResult = result.txnGroups?.[0]?.txnResults?.[0];
      if (!txnResult) return null;
      const logs = txnResult.txnResult?.logs ?? [];
      for (const log of logs) {
        if (log.length > 4 && log[0] === ARC4_RETURN_PREFIX[0] && log[1] === ARC4_RETURN_PREFIX[1] && log[2] === ARC4_RETURN_PREFIX[2] && log[3] === ARC4_RETURN_PREFIX[3]) {
          return decodeServiceData(log.slice(4));
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  /** Returns true if a service exists for the given developer+name. */
  async hasService(developerAddress, serviceName) {
    return await this.getService(developerAddress, serviceName) !== null;
  }
  /** Contract info for display. */
  getContractInfo() {
    return { appId: this.appId, appAddress: this.appAddress };
  }
};

// src/wallet-connect-terminal.ts
import WalletConnectClientModule from "@walletconnect/client";
import QRCode from "qrcode-terminal";
import algosdk5 from "algosdk";
import fs2 from "fs";
import path2 from "path";
import os2 from "os";
import chalk2 from "chalk";
var WalletConnectClient = WalletConnectClientModule.default || WalletConnectClientModule;
var DEFAULT_ADMIN_ADDRESS2 = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
var ADMIN_ADDRESS2 = process.env.CHAINPE_ADMIN_ADDRESS || DEFAULT_ADMIN_ADDRESS2;
var REGISTRATION_FEE2 = 1000000n;
var DEFAULT_APP_ID2 = 757478481n;
function readAppIdFromConfig2() {
  try {
    const configPath = path2.join(os2.homedir(), ".chainpe", "config.json");
    const config = JSON.parse(fs2.readFileSync(configPath, "utf-8"));
    if (config.registryAppId) return BigInt(config.registryAppId);
  } catch {
  }
  return void 0;
}
function getRegistryAppId2() {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) return BigInt(envId);
  return readAppIdFromConfig2() ?? DEFAULT_APP_ID2;
}
function formatAlgoFromMicro2(micro) {
  return (Number(micro) / 1e6).toFixed(6);
}
var PERA_BRIDGE = "https://wallet-connect-a.perawallet.app";
async function registerWithWalletConnectTerminal(params) {
  console.log();
  console.log(chalk2.cyan("  Initializing WalletConnect..."));
  let connector = null;
  try {
    connector = new WalletConnectClient({
      bridge: PERA_BRIDGE,
      clientMeta: {
        name: "ChainPe",
        description: "AI Agent Marketplace on Algorand",
        url: "https://chainpe.io",
        icons: ["https://chainpe.io/icon.png"]
      }
    });
    if (!connector) {
      return { success: false, error: "Failed to initialize WalletConnect connector" };
    }
    if (connector.connected) {
      await connector.killSession();
    }
    await connector.createSession();
    if (!connector.uri) {
      return { success: false, error: "Failed to generate WalletConnect URI" };
    }
    console.log();
    console.log(chalk2.yellow("  Scan with Pera Wallet:"));
    console.log();
    QRCode.generate(connector.uri, { small: true }, (qrcode) => {
      const lines = qrcode.split("\n");
      lines.forEach((line) => console.log("  " + line));
    });
    console.log();
    console.log(chalk2.gray("  Waiting for wallet connection..."));
    console.log(chalk2.gray("  (Timeout: 3 minutes)"));
    console.log();
    const connectionPromise = new Promise((resolve, reject) => {
      if (!connector) {
        reject(new Error("Connector not initialized"));
        return;
      }
      connector.on("connect", (error, payload) => {
        if (error) {
          reject(error);
        } else {
          const { accounts } = payload.params[0];
          if (accounts && accounts.length > 0) {
            resolve(accounts[0]);
          } else {
            reject(new Error("No accounts found in session"));
          }
        }
      });
      connector.on("disconnect", () => {
        reject(new Error("Wallet disconnected during connection"));
      });
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Connection timed out after 3 minutes")), 3 * 60 * 1e3);
    });
    let connectedAddress;
    try {
      connectedAddress = await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      const message = error.message;
      console.log();
      console.log(chalk2.red(`  \u2717 Connection failed: ${message}`));
      console.log();
      console.log(chalk2.gray("  Troubleshooting tips:"));
      console.log(chalk2.gray("    1. Make sure Pera Wallet app is installed"));
      console.log(chalk2.gray("    2. Scan the QR code completely"));
      console.log(chalk2.gray("    3. Check your internet connection"));
      console.log(chalk2.gray("    4. Try the mnemonic option if QR code fails"));
      console.log();
      if (connector && connector.connected) {
        await connector.killSession().catch(() => {
        });
      }
      return { success: false, error: message };
    }
    console.log(chalk2.green(`  \u2713 Connected!`));
    console.log(chalk2.gray(`    Address: ${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-4)}`));
    console.log();
    console.log(chalk2.cyan("  Building registration transaction..."));
    const algod = createAlgodClient(params.network);
    const sp = await algod.getTransactionParams().do();
    const appId = getRegistryAppId2();
    const appAddress = algosdk5.getApplicationAddress(appId);
    const boxKey = buildBoxKey2(connectedAddress, params.name);
    const nameBytes = new TextEncoder().encode(params.name);
    const boxKeySize = 4 + 32 + 1 + nameBytes.length;
    const boxValueSize = 1024;
    const boxMbr = BigInt(2500 + 400 * (boxKeySize + boxValueSize));
    const accountInfo = await algod.accountInformation(connectedAddress).do();
    const accountBalance = BigInt(accountInfo.amount ?? 0);
    const minFee = BigInt(sp.minFee ?? 1e3);
    const estimatedFees = minFee + minFee + 2000n;
    const totalRequired = boxMbr + REGISTRATION_FEE2 + estimatedFees;
    if (accountBalance < totalRequired) {
      const shortfall = totalRequired - accountBalance;
      console.log();
      console.log(chalk2.red("  \u2717 Insufficient ALGO for registration"));
      console.log(chalk2.gray(`    Connected wallet: ${connectedAddress}`));
      console.log(chalk2.gray(`    Registration fee (to admin ${ADMIN_ADDRESS2.slice(0, 8)}...${ADMIN_ADDRESS2.slice(-4)}): ${formatAlgoFromMicro2(REGISTRATION_FEE2)} ALGO`));
      console.log(chalk2.gray(`    Box storage funding: ${formatAlgoFromMicro2(boxMbr)} ALGO`));
      console.log(chalk2.gray(`    Estimated network fees: ${formatAlgoFromMicro2(estimatedFees)} ALGO`));
      console.log(chalk2.gray(`    Total required: ${formatAlgoFromMicro2(totalRequired)} ALGO`));
      console.log(chalk2.gray(`    Current balance: ${formatAlgoFromMicro2(accountBalance)} ALGO`));
      console.log(chalk2.yellow(`    Shortfall: ${formatAlgoFromMicro2(shortfall)} ALGO`));
      console.log();
      console.log(chalk2.gray("    Fund this wallet and run: chainpe register"));
      console.log(chalk2.gray("    Testnet dispenser: https://bank.testnet.algorand.network/"));
      console.log();
      if (connector && connector.connected) {
        await connector.killSession().catch(() => {
        });
      }
      return {
        success: false,
        error: `Insufficient balance: need ${formatAlgoFromMicro2(totalRequired)} ALGO, have ${formatAlgoFromMicro2(accountBalance)} ALGO`
      };
    }
    const methodSig = params.isUpdate ? "update(pay,string,string,string,string,string,string,string,string)void" : "register(pay,string,string,string,string,string,string,string,string)void";
    const selector = new Uint8Array(
      algosdk5.ABIMethod.fromSignature(methodSig).getSelector()
    );
    const appArgs = [
      selector,
      encodeArc4String2(params.name),
      encodeArc4String2(params.description),
      encodeArc4String2(params.tags.join(", ")),
      encodeArc4String2(params.endpoint),
      encodeArc4String2(params.pricePerRequest),
      encodeArc4String2(params.paymentToken),
      encodeArc4String2(params.walletAddress),
      encodeArc4String2(params.network)
    ];
    const fundTxn = algosdk5.makePaymentTxnWithSuggestedParamsFromObject({
      sender: connectedAddress,
      receiver: appAddress.toString(),
      amount: boxMbr,
      suggestedParams: sp
    });
    const payTxn = algosdk5.makePaymentTxnWithSuggestedParamsFromObject({
      sender: connectedAddress,
      receiver: ADMIN_ADDRESS2,
      amount: REGISTRATION_FEE2,
      suggestedParams: sp
    });
    const appCallTxn = algosdk5.makeApplicationNoOpTxnFromObject({
      sender: connectedAddress,
      appIndex: appId,
      appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: { ...sp, fee: 2000n, flatFee: true }
    });
    const txnGroup = [fundTxn, payTxn, appCallTxn];
    algosdk5.assignGroupID(txnGroup);
    console.log(chalk2.gray(`    Registration fee recipient: ${ADMIN_ADDRESS2}`));
    console.log(chalk2.gray(`    Registration fee amount: ${formatAlgoFromMicro2(REGISTRATION_FEE2)} ALGO`));
    console.log(chalk2.yellow("  Check Pera Wallet - approve the transaction..."));
    console.log();
    const txnsToSign = txnGroup.map((txn) => {
      return {
        txn: Buffer.from(algosdk5.encodeUnsignedTransaction(txn)).toString("base64")
      };
    });
    let signResult;
    try {
      signResult = await connector.sendCustomRequest({
        method: "algo_signTxn",
        params: [txnsToSign]
      });
    } catch (error) {
      const message = error.message;
      console.log();
      console.log(chalk2.red(`  \u2717 Transaction rejected: ${message}`));
      console.log();
      if (connector && connector.connected) {
        await connector.killSession().catch(() => {
        });
      }
      return { success: false, error: `Transaction rejected: ${message}` };
    }
    console.log(chalk2.cyan("  Submitting to Algorand..."));
    const signedTxns = [];
    for (const element of signResult) {
      if (element) {
        signedTxns.push(new Uint8Array(Buffer.from(element, "base64")));
      }
    }
    const response = await algod.sendRawTransaction(signedTxns).do();
    const txId = response.txid;
    console.log(chalk2.cyan("  Waiting for confirmation..."));
    await algosdk5.waitForConfirmation(algod, txId, 8);
    console.log();
    console.log(chalk2.green.bold("  \u2713 Service registered on-chain!"));
    console.log(chalk2.gray(`    Transaction: ${txId}`));
    console.log();
    if (connector && connector.connected) {
      await connector.killSession();
    }
    return { success: true, txnHash: txId };
  } catch (error) {
    const message = error.message;
    console.log();
    console.log(chalk2.red(`  \u2717 ${message}`));
    console.log();
    if (connector && connector.connected) {
      await connector.killSession().catch(() => {
      });
    }
    return { success: false, error: message };
  }
}
function buildBoxKey2(senderAddr, serviceName) {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk5.decodeAddress(senderAddr).publicKey;
  const colon = new TextEncoder().encode(":");
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
  let pos = 0;
  key.set(prefix, pos);
  pos += prefix.length;
  key.set(senderBytes, pos);
  pos += senderBytes.length;
  key.set(colon, pos);
  pos += colon.length;
  key.set(nameBytes, pos);
  return key;
}
function encodeArc4String2(s) {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}

// src/cli.ts
var CONFIG_DIR = path3.join(os3.homedir(), ".chainpe");
var CONFIG_FILE = path3.join(CONFIG_DIR, "config.json");
var REGISTRY_FILE = path3.join(CONFIG_DIR, "registry.json");
var DEFAULT_REGISTRY_APP_ID = "757478481";
var VERSION = "1.0.0";
var chainpeGradient = gradient(["#00D9FF", "#00FF94", "#FFD93D"]);
function getRegistryAppIdForConfig() {
  return process.env.CHAINPE_REGISTRY_APP_ID || DEFAULT_REGISTRY_APP_ID;
}
function printBanner() {
  console.log();
  console.log(
    chainpeGradient.multiline(`
   _____ _           _       _____      
  / ____| |         (_)     |  __ \\     
 | |    | |__   __ _ _ _ __ | |__) |___ 
 | |    | '_ \\ / _\` | | '_ \\|  ___/ _ \\
 | |____| | | | (_| | | | | | |  |  __/
  \\_____|_| |_|\\__,_|_|_| |_|_|   \\___|
`)
  );
  console.log(
    chalk3.gray("  AI Agent Marketplace on Algorand \u2022 x402 Micropayments")
  );
  console.log();
}
function printSection(title) {
  console.log();
  console.log(chalk3.cyan.bold(`\u25B8 ${title}`));
  console.log(chalk3.gray("\u2500".repeat(50)));
}
async function ensureConfigDir() {
  await fs3.mkdir(CONFIG_DIR, { recursive: true });
}
async function loadConfig() {
  try {
    const data = await fs3.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}
async function saveConfig(config) {
  await ensureConfigDir();
  await fs3.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function validateUrl(value) {
  if (!value) return "URL is required";
  try {
    new URL(value);
    return void 0;
  } catch {
    return "Please enter a valid URL (e.g., http://localhost:3000)";
  }
}
function validatePrice(value) {
  if (!value) return "Price is required";
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    return "Please enter a valid positive number";
  }
  return void 0;
}
function validatePort(value) {
  if (!value) return "Port is required";
  const port = parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return "Please enter a valid port number (1-65535)";
  }
  return void 0;
}
function validateWalletAddress(value) {
  if (!value) return "Wallet address is required";
  if (!isValidAlgorandAddress(value)) {
    return "Please enter a valid Algorand address (58 characters)";
  }
  return void 0;
}
async function runInit() {
  printBanner();
  p.intro(chalk3.bgCyan.black(" ChainPe Setup "));
  const existingConfig = await loadConfig();
  if (existingConfig) {
    const shouldOverwrite = await p.confirm({
      message: "Configuration already exists. Overwrite?",
      initialValue: false
    });
    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      p.cancel("Setup cancelled");
      process.exit(0);
    }
  }
  printSection("Service Configuration");
  const targetUrl = await p.text({
    message: "Your API URL (the backend ChainPe will proxy)",
    placeholder: "http://localhost:3000",
    validate: validateUrl
  });
  if (p.isCancel(targetUrl)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const serviceName = await p.text({
    message: "Service name (for registry listing)",
    placeholder: "My AI Agent API",
    validate: (value) => !value || value.length < 3 ? "Name must be at least 3 characters" : void 0
  });
  if (p.isCancel(serviceName)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const serviceDescription = await p.text({
    message: "Service description",
    placeholder: "AI-powered research assistant that analyzes documents",
    validate: (value) => !value || value.length < 10 ? "Description must be at least 10 characters" : void 0
  });
  if (p.isCancel(serviceDescription)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const tags = await p.text({
    message: "Tags (comma-separated, for discovery)",
    placeholder: "ai, research, documents, nlp"
  });
  if (p.isCancel(tags)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  printSection("Pricing");
  const pricePerRequest = await p.text({
    message: "Price per request",
    placeholder: "0.01",
    validate: validatePrice
  });
  if (p.isCancel(pricePerRequest)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const paymentToken = await p.select({
    message: "Payment token",
    options: [
      { value: "ALGO", label: "ALGO", hint: "Algorand native token" },
      { value: "USDC", label: "USDC", hint: "USD Coin (ASA)" }
    ]
  });
  if (p.isCancel(paymentToken)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  printSection("Wallet Configuration");
  console.log(chalk3.gray("  Your wallet address will receive all payments."));
  console.log(chalk3.gray("  No mnemonic needed - you just receive payments!\n"));
  const walletAddress = await p.text({
    message: "Your Algorand wallet address (to receive payments)",
    placeholder: "ALGO...",
    validate: validateWalletAddress
  });
  if (p.isCancel(walletAddress)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const spinner = ora("Validating wallet address...").start();
  try {
    const algod = createAlgodClient("testnet");
    const info = await getAccountInfo(algod, walletAddress);
    const algoBalance = formatAlgo(info.balance);
    spinner.succeed(`Wallet verified! Balance: ${chalk3.green(algoBalance)} ALGO`);
  } catch (error) {
    spinner.succeed(`Wallet address accepted: ${chalk3.cyan(walletAddress.slice(0, 8))}...${chalk3.cyan(walletAddress.slice(-4))}`);
  }
  printSection("Server Configuration");
  const proxyPort = await p.text({
    message: "Proxy port",
    placeholder: "4402",
    initialValue: "4402",
    validate: validatePort
  });
  if (p.isCancel(proxyPort)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }
  const config = {
    serviceName,
    serviceDescription,
    tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    targetUrl,
    pricePerRequest,
    paymentToken,
    walletAddress,
    proxyPort: parseInt(proxyPort, 10),
    network: "testnet",
    registryAppId: getRegistryAppIdForConfig(),
    logLevel: "normal"
  };
  spinner.start("Saving configuration...");
  try {
    await saveConfig(config);
    spinner.succeed("Configuration saved!");
  } catch (error) {
    spinner.fail("Failed to save configuration");
    p.cancel("Setup failed");
    process.exit(1);
  }
  console.log();
  console.log(chalk3.green.bold("\u2713 Configuration complete!"));
  console.log();
  console.log(chalk3.gray("  Your API will be monetized:"));
  console.log(chalk3.gray(`    Target:   ${chalk3.white(config.targetUrl)}`));
  console.log(chalk3.gray(`    Price:    ${chalk3.green(config.pricePerRequest)} ${config.paymentToken} per request`));
  console.log(chalk3.gray(`    Payments: ${chalk3.cyan(config.walletAddress.slice(0, 8))}...${chalk3.cyan(config.walletAddress.slice(-4))}`));
  console.log();
  printSection("On-Chain Registration");
  console.log(chalk3.gray("  Register your service on Algorand so AI agents can discover it."));
  console.log(chalk3.gray("  This requires signing a transaction with your wallet (~1.5 ALGO fee)."));
  console.log();
  const shouldRegister = await p.confirm({
    message: "Register service on-chain now?",
    initialValue: true
  });
  if (p.isCancel(shouldRegister)) {
    console.log();
    console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
    console.log(chalk3.gray(`  Start the proxy with: ${chalk3.cyan("chainpe start")}`));
    console.log();
    process.exit(0);
  }
  if (shouldRegister) {
    const endpoint = await p.text({
      message: "Public endpoint URL (where clients will connect)",
      placeholder: `http://localhost:${config.proxyPort}`,
      initialValue: `http://localhost:${config.proxyPort}`,
      validate: validateUrl
    });
    if (p.isCancel(endpoint)) {
      console.log();
      console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
      console.log();
    } else {
      const initRegistryClient = new ChainPeRegistryClient(config.network);
      const initAlreadyExists = await initRegistryClient.hasService(config.walletAddress, config.serviceName);
      const initIsUpdate = initAlreadyExists;
      if (initIsUpdate) {
        console.log(chalk3.yellow("  \u2139 Service already registered \u2014 will call update() on-chain."));
        console.log();
      }
      const registrationMethod = await p.select({
        message: "How would you like to sign the registration transaction?",
        options: [
          { value: "qr", label: "\u{1F4F1} Scan QR code with Pera Wallet mobile app (Recommended)" },
          { value: "mnemonic", label: "\u{1F511} Paste 25-word mnemonic phrase" },
          { value: "address", label: "\u23ED\uFE0F  Skip - register manually later" }
        ]
      });
      if (p.isCancel(registrationMethod)) {
        console.log();
        console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
        console.log();
      } else if (registrationMethod === "address") {
        console.log();
        console.log(chalk3.yellow("  \u26A0 Skipping on-chain registration"));
        console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
        console.log();
      } else if (registrationMethod === "qr") {
        console.log();
        try {
          const result = await registerWithWalletConnectTerminal({
            walletAddress: config.walletAddress,
            name: config.serviceName,
            description: config.serviceDescription,
            tags: config.tags,
            endpoint,
            pricePerRequest: config.pricePerRequest,
            paymentToken: config.paymentToken,
            network: config.network,
            isUpdate: initIsUpdate
          });
          if (!result.success) {
            console.log(chalk3.yellow(`  \u26A0 Registration failed: ${result.error || "Unknown error"}`));
            console.log(chalk3.gray(`  You can try again with: ${chalk3.cyan("chainpe register")}`));
            console.log();
          }
        } catch (error) {
          console.log(chalk3.yellow(`  \u26A0 Registration failed: ${error.message}`));
          console.log(chalk3.gray(`  You can try again with: ${chalk3.cyan("chainpe register")}`));
          console.log();
        }
      } else if (registrationMethod === "mnemonic") {
        const mnemonic = await p.password({
          message: "Enter your 25-word mnemonic phrase",
          validate: (value) => {
            if (!value || value.trim().split(/\s+/).length !== 25) {
              return "Mnemonic must be exactly 25 words";
            }
            try {
              algosdk6.mnemonicToSecretKey(value.trim());
              return;
            } catch {
              return "Invalid mnemonic phrase";
            }
          }
        });
        if (p.isCancel(mnemonic)) {
          console.log();
          console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
          console.log();
        } else {
          const spinner2 = ora(initIsUpdate ? "Updating service on-chain..." : "Registering service on-chain...").start();
          try {
            const result = await initRegistryClient.registerService({
              mnemonic,
              isUpdate: initIsUpdate,
              name: config.serviceName,
              description: config.serviceDescription,
              tags: config.tags,
              endpoint,
              pricePerRequest: config.pricePerRequest,
              paymentToken: config.paymentToken,
              walletAddress: config.walletAddress,
              network: config.network
            });
            spinner2.succeed(initIsUpdate ? "Service updated on-chain!" : "Service registered on-chain!");
            console.log(chalk3.gray(`  Transaction: ${chalk3.cyan(result.txnHash.slice(0, 20))}...`));
            console.log();
          } catch (error) {
            spinner2.fail(initIsUpdate ? "Update failed" : "Registration failed");
            console.log(chalk3.yellow(`  Error: ${error.message}`));
            console.log(chalk3.gray(`  You can try again with: ${chalk3.cyan("chainpe register")}`));
            console.log();
          }
        }
      }
    }
  } else {
    console.log();
    console.log(chalk3.gray(`  You can register later with: ${chalk3.cyan("chainpe register")}`));
    console.log();
  }
  printSection("Start Proxy");
  const shouldStart = await p.confirm({
    message: "Start the payment proxy now?",
    initialValue: true
  });
  if (p.isCancel(shouldStart) || !shouldStart) {
    console.log();
    console.log(chalk3.gray("  Start later with:"));
    console.log(chalk3.white(`    ${chalk3.cyan("chainpe start")}`));
    console.log(chalk3.gray("  Or with local facilitator (no external server needed):"));
    console.log(chalk3.white(`    ${chalk3.cyan('chainpe start --facilitator "your 25 word mnemonic"')}`));
    console.log();
    p.outro(chalk3.green("Setup complete! \u{1F680}"));
    process.exit(0);
  }
  console.log();
  console.log(chalk3.gray("  The x402 payment system needs a facilitator to verify payments."));
  console.log(chalk3.gray("  You can use the remote facilitator (default) or run locally."));
  console.log();
  const facilitatorMode = await p.select({
    message: "Choose facilitator mode",
    options: [
      { value: "remote", label: "\u{1F310} Remote facilitator (Recommended)", hint: "Uses external server - simpler setup" },
      { value: "local", label: "\u{1F4BB} Local facilitator", hint: "Run in-process - needs a funded wallet" }
    ]
  });
  let facilitatorMnemonic;
  if (facilitatorMode === "local") {
    console.log();
    console.log(chalk3.yellow("  Local facilitator requires a wallet with ALGO to pay tx fees."));
    console.log(chalk3.gray("  This wallet is ONLY used to verify/settle payments - it doesn't receive them."));
    console.log();
    const mnemonic = await p.password({
      message: "Enter 25-word mnemonic for facilitator wallet",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Mnemonic is required";
        }
        const words = value.trim().split(/\s+/);
        if (words.length !== 25) {
          return `Expected 25 words, got ${words.length}`;
        }
        try {
          algosdk6.mnemonicToSecretKey(value.trim());
          return void 0;
        } catch {
          return "Invalid mnemonic phrase";
        }
      }
    });
    if (p.isCancel(mnemonic)) {
      console.log(chalk3.gray("  Falling back to remote facilitator..."));
    } else {
      facilitatorMnemonic = mnemonic;
    }
  }
  console.log();
  console.log(chalk3.gray("  Starting x402 payment gateway..."));
  console.log();
  try {
    await startProxyServer({ config, facilitatorMnemonic });
    console.log(chalk3.gray("  Press Ctrl+C to stop"));
    console.log();
    process.on("SIGINT", () => {
      console.log();
      console.log(chalk3.yellow("  Shutting down..."));
      process.exit(0);
    });
  } catch (error) {
    console.log(chalk3.red(`\u2717 Failed to start server: ${error.message}`));
    process.exit(1);
  }
}
async function runStart(options) {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk3.red("\u2717 No configuration found."));
    console.log(chalk3.gray(`  Run ${chalk3.cyan("chainpe init")} first.`));
    process.exit(1);
  }
  if (options.port) {
    config.proxyPort = parseInt(options.port, 10);
  }
  if (options.verbose) {
    setLogLevel("verbose");
  } else if (config.logLevel) {
    setLogLevel(config.logLevel);
  }
  console.log(chalk3.gray("  Starting x402 payment gateway..."));
  console.log();
  console.log(chalk3.gray("  Configuration:"));
  console.log(chalk3.gray(`    Service:  ${chalk3.white(config.serviceName)}`));
  console.log(chalk3.gray(`    Target:   ${chalk3.white(config.targetUrl)}`));
  console.log(chalk3.gray(`    Price:    ${chalk3.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk3.gray(`    Wallet:   ${chalk3.cyan(config.walletAddress.slice(0, 8))}...${chalk3.cyan(config.walletAddress.slice(-4))}`));
  console.log(chalk3.gray(`    Network:  ${chalk3.yellow(config.network)}`));
  if (options.facilitator) {
    console.log(chalk3.gray(`    Mode:     ${chalk3.green("Local facilitator (with signing)")}`));
  } else {
    console.log(chalk3.gray(`    Mode:     ${chalk3.green("Simple verifier (no mnemonic needed)")}`));
  }
  console.log();
  try {
    await startProxyServer({
      config,
      facilitatorMnemonic: options.facilitator
    });
    console.log(chalk3.gray("  Press Ctrl+C to stop"));
    console.log();
    process.on("SIGINT", () => {
      console.log();
      console.log(chalk3.yellow("  Shutting down..."));
      process.exit(0);
    });
  } catch (error) {
    console.log(chalk3.red(`\u2717 Failed to start server: ${error.message}`));
    process.exit(1);
  }
}
async function runRegister() {
  printBanner();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk3.red("\u2717 No configuration found."));
    console.log(chalk3.gray(`  Run ${chalk3.cyan("chainpe init")} first.`));
    process.exit(1);
  }
  p.intro(chalk3.bgCyan.black(" Register Service On-Chain "));
  const endpoint = await p.text({
    message: "Public endpoint URL (where clients will connect)",
    placeholder: `http://localhost:${config.proxyPort}`,
    initialValue: `http://localhost:${config.proxyPort}`,
    validate: validateUrl
  });
  if (p.isCancel(endpoint)) {
    p.cancel("Registration cancelled");
    process.exit(0);
  }
  const registryClient = new ChainPeRegistryClient(config.network);
  const alreadyExists = await registryClient.hasService(config.walletAddress, config.serviceName);
  const isUpdate = alreadyExists;
  console.log();
  console.log(chalk3.gray(`  Service to ${isUpdate ? "update" : "register"}:`));
  console.log(chalk3.gray(`    Name:     ${chalk3.white(config.serviceName)}`));
  console.log(chalk3.gray(`    Price:    ${chalk3.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk3.gray(`    Endpoint: ${chalk3.cyan(endpoint)}`));
  console.log(chalk3.gray(`    Wallet:   ${chalk3.cyan(config.walletAddress.slice(0, 8))}...${chalk3.cyan(config.walletAddress.slice(-4))}`));
  if (isUpdate) {
    console.log(chalk3.yellow("  \u2139 Service already registered \u2014 will call update() on-chain."));
  }
  console.log();
  console.log(chalk3.gray("  Fee: ~1.5 ALGO (1 ALGO registration + storage)"));
  console.log();
  const registrationMethod = await p.select({
    message: "How would you like to sign the registration transaction?",
    options: [
      { value: "qr", label: "Scan QR code with Pera Wallet (Recommended)", hint: "Mobile app" },
      { value: "mnemonic", label: "Paste 25-word mnemonic phrase", hint: "Direct signing" }
    ]
  });
  if (p.isCancel(registrationMethod)) {
    p.cancel("Registration cancelled");
    process.exit(0);
  }
  if (registrationMethod === "qr") {
    console.log();
    try {
      const result = await registerWithWalletConnectTerminal({
        walletAddress: config.walletAddress,
        name: config.serviceName,
        description: config.serviceDescription,
        tags: config.tags,
        endpoint,
        pricePerRequest: config.pricePerRequest,
        paymentToken: config.paymentToken,
        network: config.network,
        isUpdate
      });
      if (result.success && result.txnHash) {
        const explorerBase = config.network === "mainnet" ? "https://explorer.perawallet.app" : "https://testnet.explorer.perawallet.app";
        console.log(chalk3.gray(`    Explorer: ${chalk3.cyan(`${explorerBase}/tx/${result.txnHash}/`)}`));
        console.log();
        p.outro(chalk3.green("Service is now discoverable on Algorand!"));
      } else {
        console.log();
        console.log(chalk3.red(`  \u2717 Registration failed: ${result.error || "Unknown error"}`));
        process.exit(1);
      }
    } catch (error) {
      console.log(chalk3.red(`  \u2717 Registration failed: ${error.message}`));
      process.exit(1);
    }
  } else if (registrationMethod === "mnemonic") {
    const mnemonic = await p.password({
      message: "Enter your 25-word mnemonic phrase",
      validate: (value) => {
        if (!value || value.trim().split(/\s+/).length !== 25) {
          return "Mnemonic must be exactly 25 words";
        }
        try {
          algosdk6.mnemonicToSecretKey(value.trim());
          return;
        } catch {
          return "Invalid mnemonic phrase";
        }
      }
    });
    if (p.isCancel(mnemonic)) {
      p.cancel("Registration cancelled");
      process.exit(0);
    }
    const spinner = ora(isUpdate ? "Updating service on-chain..." : "Registering service on-chain...").start();
    try {
      const result = await registryClient.registerService({
        mnemonic,
        isUpdate,
        name: config.serviceName,
        description: config.serviceDescription,
        tags: config.tags,
        endpoint,
        pricePerRequest: config.pricePerRequest,
        paymentToken: config.paymentToken,
        walletAddress: config.walletAddress,
        network: config.network
      });
      spinner.succeed(isUpdate ? "Service updated on-chain!" : "Service registered on-chain!");
      console.log(chalk3.gray(`    Transaction: ${chalk3.cyan(result.txnHash)}`));
      const explorerBase = config.network === "mainnet" ? "https://explorer.perawallet.app" : "https://testnet.explorer.perawallet.app";
      console.log(chalk3.gray(`    Explorer: ${chalk3.cyan(`${explorerBase}/tx/${result.txnHash}/`)}`));
      console.log();
      p.outro(chalk3.green("Service is now discoverable on Algorand!"));
    } catch (error) {
      spinner.fail(isUpdate ? "Update failed" : "Registration failed");
      console.log(chalk3.red(`  \u2717 ${error.message}`));
      process.exit(1);
    }
  }
}
async function runList() {
  printBanner();
  console.log(chalk3.cyan.bold("\u25B8 Registered Services (Algorand Testnet)"));
  console.log(chalk3.gray("\u2500".repeat(50)));
  console.log();
  const config = await loadConfig();
  if (!config) {
    console.log(chalk3.gray("  Run chainpe init first."));
    console.log();
    return;
  }
  const spinner = ora("Fetching service from on-chain registry...").start();
  try {
    const registryClient = new ChainPeRegistryClient(config.network);
    const svc = await registryClient.getService(config.walletAddress, config.serviceName);
    spinner.stop();
    if (!svc) {
      console.log(chalk3.gray("  No service registered on-chain yet."));
      console.log(chalk3.gray(`  Run ${chalk3.cyan("chainpe register")} to register your service.`));
      console.log();
      return;
    }
    const { appId, appAddress } = registryClient.getContractInfo();
    console.log(chalk3.white.bold(`  ${svc.name}`));
    console.log(chalk3.gray(`    ${svc.description}`));
    console.log(chalk3.gray(`    Endpoint:   ${chalk3.cyan(svc.endpoint)}`));
    console.log(chalk3.gray(`    Price:      ${chalk3.green(svc.pricePerRequest)} ${svc.paymentToken}`));
    console.log(chalk3.gray(`    Tags:       ${svc.tags.join(", ")}`));
    console.log(chalk3.gray(`    Network:    ${chalk3.yellow(svc.network)}`));
    console.log(chalk3.gray(`    Developer:  ${chalk3.white(svc.developer)}`));
    console.log(chalk3.gray(`    App ID:     ${chalk3.white(appId.toString())}`));
    console.log();
    console.log(chalk3.gray(`  Total: 1 service (on-chain, App ID: ${appId})`));
    console.log();
  } catch (error) {
    spinner.fail("Failed to fetch from on-chain registry");
    console.log(chalk3.red(`  ${error.message}`));
  }
}
async function runStatus() {
  printBanner();
  const config = await loadConfig();
  console.log(chalk3.cyan.bold("\u25B8 ChainPe Status"));
  console.log(chalk3.gray("\u2500".repeat(50)));
  console.log();
  if (!config) {
    console.log(chalk3.yellow("  \u26A0 Not configured"));
    console.log(chalk3.gray(`    Run ${chalk3.cyan("chainpe init")} to get started.`));
    console.log();
    return;
  }
  console.log(chalk3.gray("  Configuration:"));
  console.log(chalk3.gray(`    Service:     ${chalk3.white(config.serviceName)}`));
  console.log(chalk3.gray(`    Description: ${chalk3.white(config.serviceDescription)}`));
  console.log(chalk3.gray(`    Target:      ${chalk3.white(config.targetUrl)}`));
  console.log(chalk3.gray(`    Price:       ${chalk3.green(config.pricePerRequest)} ${config.paymentToken}`));
  console.log(chalk3.gray(`    Port:        ${chalk3.white(config.proxyPort.toString())}`));
  console.log(chalk3.gray(`    Network:     ${chalk3.yellow(config.network)}`));
  console.log();
  console.log(chalk3.gray("  Wallet (receives payments):"));
  console.log(chalk3.gray(`    Address:     ${chalk3.cyan(config.walletAddress)}`));
  const spinner = ora("Checking balance...").start();
  try {
    const algod = createAlgodClient("testnet");
    const info = await getAccountInfo(algod, config.walletAddress);
    const algoBalance = formatAlgo(info.balance);
    spinner.stop();
    console.log(chalk3.gray(`    Balance:     ${chalk3.green(algoBalance)} ALGO`));
    const usdcAsset = info.assets.find((a) => a.assetId === 10458941n);
    if (usdcAsset) {
      const usdcBalance = formatAlgo(usdcAsset.amount);
      console.log(chalk3.gray(`                 ${chalk3.green(usdcBalance)} USDC`));
    }
  } catch {
    spinner.stop();
    console.log(chalk3.gray(`    Balance:     ${chalk3.yellow("(could not fetch)")}`));
  }
  console.log();
  const registryClient = new ChainPeRegistryClient(config.network);
  const { appId } = registryClient.getContractInfo();
  console.log(chalk3.gray("  Registry:"));
  console.log(chalk3.gray(`    Contract:    ${chalk3.white(`App ID ${appId} (testnet)`)}`));
  const spinnerReg = ora("Checking on-chain registration...").start();
  try {
    const isRegistered = await registryClient.hasService(config.walletAddress, config.serviceName);
    spinnerReg.stop();
    console.log(
      chalk3.gray(
        `    Status:      ${isRegistered ? chalk3.green("\u2713 registered on-chain") : chalk3.yellow("\u25CB not registered")}`
      )
    );
    if (!isRegistered) {
      console.log(chalk3.gray(`    Run ${chalk3.cyan("chainpe register")} to list your service.`));
    }
  } catch {
    spinnerReg.stop();
    console.log(chalk3.gray(`    Status:      ${chalk3.yellow("(could not check)")}`));
  }
  console.log();
}
program.name("chainpe").description("ChainPe \u2014 Monetize any API with x402 micropayments on Algorand").version(VERSION);
program.command("init").description("Initialize a new ChainPe configuration").action(runInit);
program.command("start").description("Start the x402 payment proxy").option("-p, --port <port>", "Override the proxy port").option("-v, --verbose", "Enable verbose logging").option("-f, --facilitator <mnemonic>", "25-word mnemonic for local facilitator (enables offline mode)").action(runStart);
program.command("register").description("Register your service in the local registry").action(runRegister);
program.command("list").description("List all registered services").action(runList);
program.command("status").description("Show current configuration and status").action(runStatus);
program.parse();
//# sourceMappingURL=cli.js.map