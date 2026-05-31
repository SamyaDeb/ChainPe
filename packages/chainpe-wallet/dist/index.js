#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/wallet-store.ts
import fs from "fs";
import path from "path";
import os from "os";
var WALLET_DIR = path.join(os.homedir(), ".chainpe");
var WALLET_PATH = path.join(WALLET_DIR, "wallet.json");
function loadWalletConfig() {
  try {
    const raw = fs.readFileSync(WALLET_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/config.ts
function loadConfig() {
  const state = buildState();
  return {
    ...state,
    reload() {
      const fresh = buildState();
      Object.assign(this, fresh);
    }
  };
}
function buildState() {
  const wallet = loadWalletConfig();
  const algorandMnemonic = process.env.ALGORAND_MNEMONIC ?? wallet?.algorandMnemonic ?? void 0;
  const network = process.env.NETWORK ?? wallet?.network ?? "algorand-testnet";
  const registryAppId = process.env.CHAINPE_REGISTRY_APP_ID ?? wallet?.registryAppId ?? void 0;
  const maxPerCall = process.env.MAX_PER_CALL ?? "0.10";
  const maxPerDay = process.env.MAX_PER_DAY ?? "20.00";
  const canPayAlgorand = !!algorandMnemonic;
  const canPay = canPayAlgorand;
  return {
    algorandMnemonic,
    network,
    registryAppId,
    budget: { maxPerCall, maxPerDay },
    canPay,
    canPayAlgorand,
    mode: canPayAlgorand ? "ALGORAND_ONLY" : "READ_ONLY"
  };
}

// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// src/spending.ts
var SpendingTracker = class {
  config;
  spentToday = 0;
  spentSession = 0;
  lastReset = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  history = [];
  constructor(config2) {
    this.config = config2;
  }
  check(amountUsdc) {
    this.resetDailyIfNeeded();
    const amount = parseFloat(amountUsdc);
    const maxPerCall = parseFloat(this.config.maxPerCall);
    const maxPerDay = parseFloat(this.config.maxPerDay);
    if (amount > maxPerCall) {
      throw new Error(
        `Amount $${amountUsdc} exceeds per-call limit of $${this.config.maxPerCall}`
      );
    }
    if (this.spentToday + amount > maxPerDay) {
      throw new Error(
        `Payment would exceed daily limit of $${this.config.maxPerDay} (spent today: $${this.spentToday.toFixed(4)})`
      );
    }
  }
  record(amountUsdc, recipient, network) {
    const amount = parseFloat(amountUsdc);
    this.spentToday += amount;
    this.spentSession += amount;
    this.history.push({
      recipient,
      amount: amountUsdc,
      network,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  getSummary() {
    this.resetDailyIfNeeded();
    return {
      spentToday: this.spentToday.toFixed(4),
      spentSession: this.spentSession.toFixed(4),
      limits: {
        maxPerCall: this.config.maxPerCall,
        maxPerDay: this.config.maxPerDay
      },
      recentPayments: this.history.slice(-10)
    };
  }
  resetDailyIfNeeded() {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    if (today !== this.lastReset) {
      this.spentToday = 0;
      this.lastReset = today;
    }
  }
};

// src/clients.ts
var CAIP2_NETWORKS = {
  algorand: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
  "algorand-testnet": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
};
function isAlgorandNetwork(network) {
  return network === "algorand" || network === "algorand-testnet";
}
function getCaip2Network(network) {
  return CAIP2_NETWORKS[network];
}
function algodUrlFor(network) {
  return network === "algorand-testnet" ? "https://testnet-api.algonode.cloud" : "https://mainnet-api.algonode.cloud";
}
async function createAlgorandSigner(mnemonic) {
  const algosdk5 = await import("algosdk");
  const { sk, addr } = algosdk5.default.mnemonicToSecretKey(mnemonic);
  const address = algosdk5.default.encodeAddress(addr.publicKey);
  return {
    address,
    signTransactions: async (txns, indexesToSign) => {
      return txns.map((txnBytes, i) => {
        if (indexesToSign && !indexesToSign.includes(i)) return null;
        const decoded = algosdk5.default.decodeUnsignedTransaction(txnBytes);
        const signed = algosdk5.default.signTransaction(decoded, sk);
        return signed.blob;
      });
    }
  };
}
async function createHttpClient(network, config2) {
  if (!isAlgorandNetwork(network) || !config2.algorandMnemonic) {
    throw new Error(`No Algorand key configured for network ${network}`);
  }
  const { x402Client, x402HTTPClient } = await import("@x402-avm/core/client");
  const { registerExactAvmScheme } = await import("@x402-avm/avm/exact/client");
  const client = new x402Client();
  const signer = await createAlgorandSigner(config2.algorandMnemonic);
  registerExactAvmScheme(client, {
    signer,
    algodConfig: { algodUrl: algodUrlFor(network) }
  });
  return new x402HTTPClient(client);
}
async function getWalletAddress(network, config2) {
  if (isAlgorandNetwork(network) && config2.algorandMnemonic) {
    const algosdk5 = await import("algosdk");
    const { addr } = algosdk5.default.mnemonicToSecretKey(config2.algorandMnemonic);
    return algosdk5.default.encodeAddress(addr.publicKey);
  }
  throw new Error(`No key configured for network ${network}`);
}
var USDC_ASA = {
  "algorand-testnet": 10458941,
  // USDC on Algorand Testnet
  algorand: 31566704
  // USDC on Algorand Mainnet
};
async function getUsdcBalance(network, config2) {
  if (!isAlgorandNetwork(network) || !config2.algorandMnemonic) {
    throw new Error(`No key configured for network ${network}`);
  }
  try {
    const algosdk5 = await import("algosdk");
    const { addr } = algosdk5.default.mnemonicToSecretKey(config2.algorandMnemonic);
    const algodClient = new algosdk5.default.Algodv2("", algodUrlFor(network), "");
    const accountInfo = await algodClient.accountInformation(addr).do();
    const assetId = USDC_ASA[network];
    const usdcAsset = accountInfo.assets?.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a) => Number(a.assetId ?? a["asset-id"]) === assetId
    );
    if (!usdcAsset) return "0.000000 (not opted-in to USDC)";
    const raw = BigInt(usdcAsset.amount ?? 0);
    const decimals = 6;
    const whole = raw / BigInt(10 ** decimals);
    const frac = raw % BigInt(10 ** decimals);
    return `${whole}.${frac.toString().padStart(decimals, "0")}`;
  } catch {
    return "0.000000";
  }
}

// src/tools/check-balance.ts
async function getAlgoBalance(address, network) {
  const algodUrl = network === "algorand-testnet" ? "https://testnet-api.algonode.cloud" : "https://mainnet-api.algonode.cloud";
  try {
    const algosdk5 = await import("algosdk");
    const algodClient = new algosdk5.default.Algodv2("", algodUrl, "");
    const info = await algodClient.accountInformation(address).do();
    const micro = BigInt(info.amount ?? 0);
    const whole = micro / 1000000n;
    const frac = micro % 1000000n;
    return `${whole}.${frac.toString().padStart(6, "0")}`;
  } catch {
    return "unavailable";
  }
}
function registerCheckBalance(server2, config2) {
  server2.tool(
    "check_balance",
    "Check wallet balances: USDC and native ALGO for gas fees on Algorand Testnet/Mainnet.",
    {},
    async () => {
      if (!config2.canPay) {
        return {
          content: [
            {
              type: "text",
              text: "No wallet configured. Set ALGORAND_MNEMONIC environment variable."
            }
          ],
          isError: true
        };
      }
      try {
        const address = await getWalletAddress(config2.network, config2);
        const usdcBalance = await getUsdcBalance(config2.network, config2);
        const result = {
          address,
          network: config2.network,
          mode: config2.mode,
          usdc: `${usdcBalance} USDC`
        };
        if (isAlgorandNetwork(config2.network)) {
          const algoBalance = await getAlgoBalance(address, config2.network);
          result.algo = `${algoBalance} ALGO`;
          result.swapNote = "ALGO is needed for Algorand network fees (~0.001 ALGO/txn) and Tinyman swaps.";
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/pay.ts
import { z } from "zod";
var USDC_ASA2 = {
  algorand: "31566704",
  // mainnet
  "algorand-testnet": "10458941"
  // testnet
};
function registerPay(server2, config2, spending) {
  server2.tool(
    "pay",
    "Sign and create an x402 payment header (USDC transfer authorization) on Algorand. Returns the payment header value to attach to your HTTP request.",
    {
      amount: z.string().describe('USDC amount as decimal string, e.g. "0.05"'),
      recipient: z.string().describe("Recipient Algorand address (58 chars)"),
      network: z.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Algorand payment network"),
      resource: z.string().optional().describe("URL of the resource being paid for")
    },
    async ({ amount, recipient, network, resource }) => {
      if (!config2.canPay) {
        return {
          content: [
            {
              type: "text",
              text: "No wallet configured. Set ALGORAND_MNEMONIC to sign payments."
            }
          ],
          isError: true
        };
      }
      const net = network;
      try {
        spending.check(amount);
        const httpClient = await createHttpClient(net, config2);
        const caip2 = getCaip2Network(net);
        const paymentRequired = {
          x402Version: 2,
          error: "",
          resource: {
            url: resource ?? "",
            description: "",
            mimeType: ""
          },
          accepts: [
            {
              scheme: "exact",
              network: caip2,
              asset: USDC_ASA2[net],
              amount: toAtomicUnits(amount),
              payTo: recipient,
              maxTimeoutSeconds: 300,
              // No extra fields needed for the Algorand AVM exact scheme
              extra: {}
            }
          ]
        };
        const payload = await httpClient.createPaymentPayload(paymentRequired);
        const signatureHeaders = httpClient.encodePaymentSignatureHeader(payload);
        if (!signatureHeaders || Object.keys(signatureHeaders).length === 0) {
          throw new Error("Failed to generate payment header");
        }
        spending.record(amount, recipient, network);
        const [[headerName, headerValue]] = Object.entries(signatureHeaders);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  paymentHeader: headerValue,
                  headerName,
                  amount: `${amount} USDC`,
                  recipient,
                  network,
                  resource: resource ?? null,
                  hint: `Set this as the ${headerName} header in your HTTP request.`
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Payment failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}
function toAtomicUnits(amount) {
  const decimals = 6;
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac)).toString();
}

// src/tools/x402-fetch.ts
import { z as z2 } from "zod";
function isLikelyTextContentType(contentType) {
  if (!contentType) return false;
  const normalized = contentType.toLowerCase();
  return normalized.startsWith("text/") || normalized.includes("application/json") || normalized.includes("application/xml") || normalized.includes("application/javascript") || normalized.includes("application/x-www-form-urlencoded");
}
async function formatResponseBody(response) {
  const contentType = response.headers.get("content-type");
  const contentLength = response.headers.get("content-length");
  if (isLikelyTextContentType(contentType)) {
    return {
      body: await response.text(),
      bodyEncoding: "text",
      contentType,
      contentLength
    };
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    body: Buffer.from(arrayBuffer).toString("base64"),
    bodyEncoding: "base64",
    contentType,
    contentLength
  };
}
var CAIP2_TO_NETWORK = {
  "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": "algorand",
  "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=": "algorand-testnet"
};
function caip2ToNetwork(caip2) {
  return CAIP2_TO_NETWORK[caip2];
}
function atomicToUsdc(atomicAmount) {
  const decimals = 6;
  const raw = BigInt(atomicAmount);
  const whole = raw / BigInt(10 ** decimals);
  const frac = raw % BigInt(10 ** decimals);
  return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}
function registerX402Fetch(server2, config2, spending) {
  server2.tool(
    "x402_fetch",
    "Fetch a URL with automatic x402 payment. Makes the HTTP request, and if the server responds with 402 Payment Required, automatically signs the USDC payment and retries with the X-PAYMENT header. Returns the final response.",
    {
      url: z2.string().url().describe("The URL to fetch"),
      method: z2.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET").describe("HTTP method (default: GET)"),
      headers: z2.record(z2.string()).optional().describe("Optional HTTP headers as key-value pairs"),
      body: z2.string().optional().describe("Optional request body")
    },
    async ({ url, method, headers, body }) => {
      if (!config2.canPay) {
        return {
          content: [
            {
              type: "text",
              text: "No wallet configured. Set STELLAR_SECRET, EVM_PRIVATE_KEY, or ALGORAND_MNEMONIC environment variable."
            }
          ],
          isError: true
        };
      }
      try {
        const fetchOptions = {
          method,
          headers: headers ?? {}
        };
        if (body && method !== "GET") {
          fetchOptions.body = body;
        }
        const initialResponse = await fetch(url, fetchOptions);
        if (initialResponse.status !== 402) {
          const responsePayload2 = await formatResponseBody(initialResponse);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: initialResponse.status,
                    statusText: initialResponse.statusText,
                    body: responsePayload2.body,
                    bodyEncoding: responsePayload2.bodyEncoding,
                    contentType: responsePayload2.contentType,
                    contentLength: responsePayload2.contentLength
                  },
                  null,
                  2
                )
              }
            ]
          };
        }
        let paymentRequired;
        const paymentRequiredHeader = initialResponse.headers.get("Payment-Required");
        if (paymentRequiredHeader) {
          const decoded = Buffer.from(paymentRequiredHeader, "base64").toString(
            "utf-8"
          );
          paymentRequired = JSON.parse(decoded);
        } else {
          paymentRequired = await initialResponse.json();
        }
        if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Server returned 402 but no payment options were provided."
              }
            ],
            isError: true
          };
        }
        const accept = paymentRequired.accepts.find((a) => {
          const net = caip2ToNetwork(a.network);
          if (!net) return false;
          return isAlgorandNetwork(net) && config2.canPayAlgorand;
        });
        if (!accept) {
          const networks = paymentRequired.accepts.map((a) => a.network).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `Cannot fulfill payment. Server accepts networks: [${networks}] but wallet is not configured for any of them.`
              }
            ],
            isError: true
          };
        }
        const network = caip2ToNetwork(accept.network);
        const usdcAmount = atomicToUsdc(accept.amount);
        spending.check(usdcAmount);
        const httpClient = await createHttpClient(network, config2);
        const payload = await httpClient.createPaymentPayload(paymentRequired);
        const signatureHeaders = httpClient.encodePaymentSignatureHeader(payload);
        if (!signatureHeaders || Object.keys(signatureHeaders).length === 0) {
          throw new Error("Failed to generate payment header");
        }
        const retryOptions = {
          method,
          headers: {
            ...headers ?? {},
            ...signatureHeaders
          }
        };
        if (body && method !== "GET") {
          retryOptions.body = body;
        }
        const paidResponse = await fetch(url, retryOptions);
        const responsePayload = await formatResponseBody(paidResponse);
        if (paidResponse.status === 402) {
          return {
            content: [
              {
                type: "text",
                text: [
                  "Payment signed and sent, but the server could not settle the transaction.",
                  "This almost always means the paying wallet needs:",
                  `  1. Testnet USDC (ASA ID 10458941) \u2014 at least ${usdcAmount} USDC`,
                  "  2. Opted-in to the USDC asset (Pera Wallet \u2192 Add asset \u2192 10458941)",
                  "  3. A small amount of ALGO for the network fee (~0.001 ALGO)",
                  "",
                  "Get testnet funds:",
                  "  \u2022 ALGO:  https://bank.testnet.algorand.network/",
                  "  \u2022 USDC:  https://faucet.circle.com  (choose Algorand Testnet)",
                  "",
                  `Attempted payment: ${usdcAmount} USDC \u2192 ${accept.payTo} on ${network}`
                ].join("\n")
              }
            ],
            isError: true
          };
        }
        spending.record(usdcAmount, accept.payTo, network);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: paidResponse.status,
                  statusText: paidResponse.statusText,
                  body: responsePayload.body,
                  bodyEncoding: responsePayload.bodyEncoding,
                  contentType: responsePayload.contentType,
                  contentLength: responsePayload.contentLength,
                  payment: {
                    amount: `${usdcAmount} USDC`,
                    recipient: accept.payTo,
                    network
                  },
                  hint: responsePayload.bodyEncoding === "base64" ? "Binary response returned as base64. Decode and save it using the reported contentType." : void 0
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `x402 fetch failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/transfer-usdc.ts
import { z as z3 } from "zod";

// src/nfd.ts
var NFD_API = "https://api.nf.domains";
function isNfdName(value) {
  const lower = value.trim().toLowerCase();
  return lower.endsWith(".algo") || lower.endsWith(".nfd");
}
async function resolveNfd(name) {
  const lower = name.trim().toLowerCase();
  const url = `${NFD_API}/nfd/${encodeURIComponent(lower)}?view=brief`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`NFD name "${name}" not found. Make sure it's a valid .algo or .nfd domain.`);
    }
    throw new Error(`NFD API error ${res.status} while resolving "${name}"`);
  }
  const data = await res.json();
  const address = data.caAlgo?.[0] ?? data.owner;
  if (!address) {
    throw new Error(`NFD "${name}" resolved but has no associated Algorand address.`);
  }
  return address;
}

// src/tools/transfer-usdc.ts
var USDC_ASA3 = {
  algorand: 31566704,
  // USDC mainnet
  "algorand-testnet": 10458941
  // USDC testnet
};
var ALGOD_URLS = {
  algorand: "https://mainnet-api.algonode.cloud",
  "algorand-testnet": "https://testnet-api.algonode.cloud"
};
function registerTransferUsdc(server2, config2, spending) {
  server2.tool(
    "transfer_usdc",
    "Send USDC directly on-chain from your Algorand wallet to another address. This is a real on-chain ASA transfer \u2014 NOT an x402 payment header. Use this to send USDC to a friend, top up a wallet, or move funds.",
    {
      to: z3.string().describe('Recipient: an Algorand address (58 chars) OR an NFD name like "satoshi.algo" or "bob.nfd"'),
      amount: z3.string().describe('USDC amount as decimal string, e.g. "1.50" for $1.50 USDC'),
      network: z3.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Algorand network (default: algorand-testnet)"),
      note: z3.string().optional().describe("Optional memo/note to include in the transaction (max 1000 bytes)")
    },
    async ({ to, amount, network, note }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [
            {
              type: "text",
              text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC environment variable."
            }
          ],
          isError: true
        };
      }
      try {
        spending.check(amount);
        let resolvedTo = to;
        if (isNfdName(to)) {
          resolvedTo = await resolveNfd(to);
        }
        const algosdk5 = (await import("algosdk")).default;
        const { sk, addr } = algosdk5.mnemonicToSecretKey(config2.algorandMnemonic);
        const sender = algosdk5.encodeAddress(addr.publicKey);
        const algodUrl = ALGOD_URLS[network] ?? ALGOD_URLS["algorand-testnet"];
        const algodClient = new algosdk5.Algodv2("", algodUrl, "");
        const parts = amount.split(".");
        const whole = parts[0] || "0";
        const frac = (parts[1] || "").padEnd(6, "0").slice(0, 6);
        const microUsdc = BigInt(whole) * 1000000n + BigInt(frac);
        if (microUsdc <= 0n) {
          return {
            content: [{ type: "text", text: "Amount must be greater than 0." }],
            isError: true
          };
        }
        const assetId = USDC_ASA3[network];
        if (!assetId) {
          return {
            content: [{ type: "text", text: `Unknown network: ${network}` }],
            isError: true
          };
        }
        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk5.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender,
          receiver: resolvedTo,
          amount: microUsdc,
          assetIndex: assetId,
          suggestedParams,
          note: note ? new TextEncoder().encode(note) : void 0
        });
        const signedTxn = algosdk5.signTransaction(txn, sk);
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do();
        const confirmation = await algosdk5.waitForConfirmation(algodClient, txid, 5);
        spending.record(amount, resolvedTo, network);
        const explorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/tx/${txid}` : `https://explorer.perawallet.app/tx/${txid}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  from: sender,
                  to: resolvedTo,
                  nfd: resolvedTo !== to ? to : void 0,
                  amount: `${amount} USDC`,
                  assetId,
                  network,
                  confirmedRound: Number(confirmation.confirmedRound ?? 0),
                  explorerUrl,
                  note: note ?? null
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/transfer-algo.ts
import { z as z4 } from "zod";
import algosdk from "algosdk";
var ALGOD_URLS2 = {
  algorand: "https://mainnet-api.algonode.cloud",
  "algorand-testnet": "https://testnet-api.algonode.cloud"
};
function registerTransferAlgo(server2, config2) {
  server2.tool(
    "transfer_algo",
    'Send native ALGO from this agent wallet to another address or NFD name (e.g. "satoshi.algo"). Use this to pay for Algorand network fees, seed a new wallet, or transfer value in ALGO. For USDC transfers, use transfer_usdc instead.',
    {
      to: z4.string().describe('Recipient: an Algorand address (58 chars) OR an NFD name like "satoshi.algo" or "bob.nfd"'),
      amount: z4.string().describe('Amount of ALGO to send as decimal string, e.g. "1.5" for 1.5 ALGO'),
      note: z4.string().optional().describe("Optional memo/note to include in the transaction (max 1000 bytes)"),
      network: z4.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Algorand network (default: algorand-testnet)")
    },
    async ({ to, amount, note, network }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [{ type: "text", text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC." }],
          isError: true
        };
      }
      try {
        let resolvedTo = to;
        if (isNfdName(to)) {
          resolvedTo = await resolveNfd(to);
        }
        const algodUrl = ALGOD_URLS2[network] ?? ALGOD_URLS2["algorand-testnet"];
        const algodClient = new algosdk.Algodv2("", algodUrl, "");
        const { sk, addr } = algosdk.mnemonicToSecretKey(config2.algorandMnemonic);
        const sender = algosdk.encodeAddress(addr.publicKey);
        const parts = amount.split(".");
        const whole = parts[0] || "0";
        const frac = (parts[1] || "").padEnd(6, "0").slice(0, 6);
        const microAlgo = BigInt(whole) * 1000000n + BigInt(frac);
        if (microAlgo <= 0n) {
          return {
            content: [{ type: "text", text: "Amount must be greater than 0." }],
            isError: true
          };
        }
        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: resolvedTo,
          amount: microAlgo,
          suggestedParams,
          note: note ? new TextEncoder().encode(note) : void 0
        });
        const signedTxn = algosdk.signTransaction(txn, sk);
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do();
        const confirmation = await algosdk.waitForConfirmation(algodClient, txid, 5);
        const explorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/tx/${txid}` : `https://explorer.perawallet.app/tx/${txid}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  from: sender,
                  to: resolvedTo,
                  nfd: resolvedTo !== to ? to : void 0,
                  amount: `${amount} ALGO`,
                  network,
                  confirmedRound: Number(confirmation.confirmedRound ?? 0),
                  explorerUrl,
                  note: note ?? null
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/tinyman-swap.ts
import { z as z5 } from "zod";
import algosdk2 from "algosdk";
var ALGOD_URLS3 = {
  algorand: "https://mainnet-api.algonode.cloud",
  "algorand-testnet": "https://testnet-api.algonode.cloud"
};
var USDC_ASA4 = {
  algorand: 31566704,
  "algorand-testnet": 10458941
};
var ALGO_ASA_ID = 0;
function microAlgoToAlgo(microAlgo) {
  const whole = microAlgo / 1000000n;
  const frac = microAlgo % 1000000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}
function microUsdcToUsdc(mu) {
  const whole = mu / 1000000n;
  const frac = mu % 1000000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}
function decimalToMicro(amount) {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * 1000000n + BigInt(frac);
}
async function getPoolReserves(network, assetIn, assetOut) {
  const TINYMAN_APP_IDS = {
    algorand: 1002541853,
    "algorand-testnet": 148607e3
  };
  const appId = TINYMAN_APP_IDS[network];
  if (!appId) throw new Error(`No Tinyman app ID configured for network: ${network}`);
  const asset1Id = Math.min(assetIn, assetOut);
  const asset2Id = Math.max(assetIn, assetOut);
  const poolLogicSig = algosdk2.getApplicationAddress(appId);
  const indexerUrl = network === "algorand-testnet" ? "https://testnet-idx.algonode.cloud" : "https://mainnet-idx.algonode.cloud";
  const resp = await fetch(
    `${indexerUrl}/v2/accounts/${poolLogicSig}/apps-local-state?application-id=${appId}`
  );
  if (!resp.ok) throw new Error(`Indexer error: ${resp.status}`);
  await resp.json();
  const tinymanApiBase = network === "algorand-testnet" ? "https://testnet.analytics.tinyman.org" : "https://mainnet.analytics.tinyman.org";
  const poolResp = await fetch(
    `${tinymanApiBase}/api/v1/pools/${asset1Id}-${asset2Id}/`
  );
  if (!poolResp.ok) {
    throw new Error(
      `Pool not found for assets ${asset1Id}/${asset2Id} on ${network}. Pool may not exist on testnet. Try using 0 (ALGO) and ${USDC_ASA4[network]} (USDC).`
    );
  }
  const poolData = await poolResp.json();
  return {
    asset1Id,
    asset2Id,
    asset1Reserve: BigInt(poolData.asset_1_reserves ?? 0),
    asset2Reserve: BigInt(poolData.asset_2_reserves ?? 0),
    appId
  };
}
function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}
function getAmountIn(amountOut, reserveIn, reserveOut) {
  const numerator = reserveIn * amountOut * 1000n;
  const denominator = (reserveOut - amountOut) * 997n;
  return numerator / denominator + 1n;
}
function registerTinymanSwaps(server2, config2) {
  server2.tool(
    "tinyman_swap_fixed_input",
    "Swap a fixed input amount of one Algorand asset for another on Tinyman DEX (testnet). Use this when you want to spend exactly X amount. Example: swap 1 ALGO for as much USDC as possible. Asset ID 0 = ALGO (native). USDC testnet ASA ID = 10458941.",
    {
      assetInId: z5.number().int().describe("Asset ID to spend. Use 0 for native ALGO, 10458941 for USDC on testnet."),
      assetOutId: z5.number().int().describe("Asset ID to receive. Use 0 for native ALGO, 10458941 for USDC on testnet."),
      amountIn: z5.string().describe('Exact amount to spend as decimal string, e.g. "1.5" for 1.5 ALGO'),
      slippagePct: z5.number().default(1).describe("Slippage tolerance in percent (default 1%). Lower = stricter."),
      network: z5.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Network (default: algorand-testnet)")
    },
    async ({ assetInId, assetOutId, amountIn, slippagePct, network }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [{ type: "text", text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC." }],
          isError: true
        };
      }
      try {
        const algodUrl = ALGOD_URLS3[network];
        const algodClient = new algosdk2.Algodv2("", algodUrl, "");
        const { sk, addr } = algosdk2.mnemonicToSecretKey(config2.algorandMnemonic);
        const senderAddress = algosdk2.encodeAddress(addr.publicKey);
        const amountInMicro = decimalToMicro(amountIn);
        if (amountInMicro <= 0n) throw new Error("Amount must be > 0");
        const pool = await getPoolReserves(network, assetInId, assetOutId);
        const isInAsset1 = assetInId === pool.asset1Id;
        const reserveIn = isInAsset1 ? pool.asset1Reserve : pool.asset2Reserve;
        const reserveOut = isInAsset1 ? pool.asset2Reserve : pool.asset1Reserve;
        const amountOutMicro = getAmountOut(amountInMicro, reserveIn, reserveOut);
        const minAmountOut = amountOutMicro * BigInt(Math.floor((100 - slippagePct) * 10)) / 1000n;
        const params = await algodClient.getTransactionParams().do();
        const transactions = [];
        if (assetInId === ALGO_ASA_ID) {
          transactions.push(
            algosdk2.makePaymentTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk2.getApplicationAddress(pool.appId),
              amount: amountInMicro,
              suggestedParams: params
            })
          );
        } else {
          transactions.push(
            algosdk2.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk2.getApplicationAddress(pool.appId),
              amount: amountInMicro,
              assetIndex: assetInId,
              suggestedParams: params
            })
          );
        }
        transactions.push(
          algosdk2.makeApplicationNoOpTxnFromObject({
            sender: senderAddress,
            appIndex: pool.appId,
            appArgs: [
              new TextEncoder().encode("swap"),
              algosdk2.encodeUint64(minAmountOut)
            ],
            foreignAssets: [assetInId === ALGO_ASA_ID ? assetOutId : assetInId, assetOutId === ALGO_ASA_ID ? assetInId : assetOutId].filter((v, i, a) => a.indexOf(v) === i && v !== 0),
            suggestedParams: params
          })
        );
        algosdk2.assignGroupID(transactions);
        const signedTxns = transactions.map((txn) => algosdk2.signTransaction(txn, sk).blob);
        const txnBlob = Buffer.concat(signedTxns.map((s) => Buffer.from(s)));
        const { txid } = await algodClient.sendRawTransaction(txnBlob).do();
        await algosdk2.waitForConfirmation(algodClient, txid, 5);
        const explorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/tx/${txid}` : `https://explorer.perawallet.app/tx/${txid}`;
        const inLabel = assetInId === ALGO_ASA_ID ? "ALGO" : `ASA#${assetInId}`;
        const outLabel = assetOutId === ALGO_ASA_ID ? "ALGO" : `ASA#${assetOutId}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  swap: `${amountIn} ${inLabel} \u2192 ~${microUsdcToUsdc(amountOutMicro)} ${outLabel}`,
                  amountIn: `${amountIn} ${inLabel}`,
                  estimatedAmountOut: `${microUsdcToUsdc(amountOutMicro)} ${outLabel}`,
                  minAmountOut: `${microUsdcToUsdc(minAmountOut)} ${outLabel}`,
                  network,
                  explorerUrl
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Swap failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
  server2.tool(
    "tinyman_swap_fixed_output",
    "Swap to receive an exact output amount of one Algorand asset from another on Tinyman DEX (testnet). Use this when you need exactly X USDC for an x402 payment. Example: get exactly 1.05 USDC, spend as little ALGO as possible. Asset ID 0 = ALGO (native). USDC testnet ASA ID = 10458941.",
    {
      assetInId: z5.number().int().describe("Asset ID to spend. Use 0 for native ALGO, 10458941 for USDC on testnet."),
      assetOutId: z5.number().int().describe("Asset ID to receive. Use 0 for native ALGO, 10458941 for USDC on testnet."),
      amountOut: z5.string().describe('Exact amount to receive as decimal, e.g. "1.05" for 1.05 USDC'),
      slippagePct: z5.number().default(1).describe("Slippage tolerance in percent (default 1%). Higher = less likely to fail."),
      network: z5.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Network (default: algorand-testnet)")
    },
    async ({ assetInId, assetOutId, amountOut, slippagePct, network }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [{ type: "text", text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC." }],
          isError: true
        };
      }
      try {
        const algodUrl = ALGOD_URLS3[network];
        const algodClient = new algosdk2.Algodv2("", algodUrl, "");
        const { sk, addr } = algosdk2.mnemonicToSecretKey(config2.algorandMnemonic);
        const senderAddress = algosdk2.encodeAddress(addr.publicKey);
        const amountOutMicro = decimalToMicro(amountOut);
        if (amountOutMicro <= 0n) throw new Error("Amount must be > 0");
        const pool = await getPoolReserves(network, assetInId, assetOutId);
        const isInAsset1 = assetInId === pool.asset1Id;
        const reserveIn = isInAsset1 ? pool.asset1Reserve : pool.asset2Reserve;
        const reserveOut = isInAsset1 ? pool.asset2Reserve : pool.asset1Reserve;
        const amountInMicro = getAmountIn(amountOutMicro, reserveIn, reserveOut);
        const maxAmountIn = amountInMicro * BigInt(Math.floor((100 + slippagePct) * 10)) / 1000n;
        const params = await algodClient.getTransactionParams().do();
        const transactions = [];
        if (assetInId === ALGO_ASA_ID) {
          transactions.push(
            algosdk2.makePaymentTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk2.getApplicationAddress(pool.appId),
              amount: maxAmountIn,
              suggestedParams: params
            })
          );
        } else {
          transactions.push(
            algosdk2.makeAssetTransferTxnWithSuggestedParamsFromObject({
              sender: senderAddress,
              receiver: algosdk2.getApplicationAddress(pool.appId),
              amount: maxAmountIn,
              assetIndex: assetInId,
              suggestedParams: params
            })
          );
        }
        transactions.push(
          algosdk2.makeApplicationNoOpTxnFromObject({
            sender: senderAddress,
            appIndex: pool.appId,
            appArgs: [
              new TextEncoder().encode("fixed_output_swap"),
              algosdk2.encodeUint64(amountOutMicro)
            ],
            foreignAssets: [assetInId, assetOutId].filter((v) => v !== 0),
            suggestedParams: params
          })
        );
        algosdk2.assignGroupID(transactions);
        const signedTxns = transactions.map((txn) => algosdk2.signTransaction(txn, sk).blob);
        const txnBlob = Buffer.concat(signedTxns.map((s) => Buffer.from(s)));
        const { txid } = await algodClient.sendRawTransaction(txnBlob).do();
        await algosdk2.waitForConfirmation(algodClient, txid, 5);
        const explorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/tx/${txid}` : `https://explorer.perawallet.app/tx/${txid}`;
        const inLabel = assetInId === ALGO_ASA_ID ? "ALGO" : `ASA#${assetInId}`;
        const outLabel = assetOutId === ALGO_ASA_ID ? "ALGO" : `ASA#${assetOutId}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  txid,
                  swap: `~${microAlgoToAlgo(amountInMicro)} ${inLabel} \u2192 ${amountOut} ${outLabel}`,
                  estimatedAmountIn: `${microAlgoToAlgo(amountInMicro)} ${inLabel}`,
                  maxAmountIn: `${microAlgoToAlgo(maxAmountIn)} ${inLabel}`,
                  exactAmountOut: `${amountOut} ${outLabel}`,
                  network,
                  explorerUrl
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Swap failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/bazaar-search.ts
import { z as z6 } from "zod";

// src/chainpe-registry.ts
import algosdk3 from "algosdk";
var DEFAULT_APP_ID = 757478481n;
var ARC4_RETURN_PREFIX = new Uint8Array([21, 31, 124, 117]);
var ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
var ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
var INDEXER_TESTNET_URL = "https://testnet-idx.algonode.cloud";
var INDEXER_MAINNET_URL = "https://mainnet-idx.algonode.cloud";
function getRegistryAppId() {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) {
    try {
      return BigInt(envId);
    } catch {
    }
  }
  return DEFAULT_APP_ID;
}
function methodSelector(signature) {
  return algosdk3.ABIMethod.fromSignature(signature).getSelector();
}
function encodeArc4String(s) {
  const utf8 = new TextEncoder().encode(s);
  const buf = new Uint8Array(2 + utf8.length);
  new DataView(buf.buffer).setUint16(0, utf8.length, false);
  buf.set(utf8, 2);
  return buf;
}
function buildGetServiceArgs(selector, developerAddress, serviceName) {
  const addrBytes = algosdk3.decodeAddress(developerAddress).publicKey;
  const encodedName = encodeArc4String(serviceName);
  return [selector, addrBytes, encodedName];
}
function buildBoxKey(developerAddr, serviceName) {
  const prefix = new TextEncoder().encode("svc:");
  const senderBytes = algosdk3.decodeAddress(developerAddr).publicKey;
  const colon = new TextEncoder().encode(":");
  const nameBytes = new TextEncoder().encode(serviceName);
  const key = new Uint8Array(
    prefix.length + senderBytes.length + colon.length + nameBytes.length
  );
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
function decodeServiceData(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offsets = Array.from({ length: 8 }, (_, i) => view.getUint16(i * 2, false));
  const developer = algosdk3.encodeAddress(data.slice(16, 48));
  const createdAt = Number(view.getBigUint64(48, false));
  const updatedAt = Number(view.getBigUint64(56, false));
  const strings = offsets.map((off) => {
    const len = view.getUint16(off, false);
    return new TextDecoder().decode(data.slice(off + 2, off + 2 + len));
  });
  const [
    name,
    description,
    tagsStr,
    endpoint,
    pricePerRequest,
    paymentToken,
    walletAddress,
    network
  ] = strings;
  return {
    id: `${developer}:${name}`,
    name,
    description,
    tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
    endpoint,
    pricePerRequest,
    paymentToken,
    walletAddress,
    network,
    createdAt: createdAt ? new Date(createdAt * 1e3).toISOString() : void 0,
    updatedAt: updatedAt ? new Date(updatedAt * 1e3).toISOString() : void 0
  };
}
async function fetchServiceOnChain(algod, appId, developerAddress, serviceName) {
  try {
    const sig = "getService(address,string)(string,string,string,string,string,string,string,string,address,uint64,uint64)";
    const selector = methodSelector(sig);
    const appArgs = buildGetServiceArgs(selector, developerAddress, serviceName);
    const boxKey = buildBoxKey(developerAddress, serviceName);
    const sp = await algod.getTransactionParams().do();
    const tx = algosdk3.makeApplicationNoOpTxnFromObject({
      sender: developerAddress,
      appIndex: appId,
      appArgs,
      boxes: [{ appIndex: appId, name: boxKey }],
      suggestedParams: sp
    });
    const encodedTxn = algosdk3.encodeUnsignedSimulateTransaction(tx);
    const signedTxn = algosdk3.decodeSignedTransaction(encodedTxn);
    const request = new algosdk3.modelsv2.SimulateRequest({
      txnGroups: [
        new algosdk3.modelsv2.SimulateRequestTransactionGroup({ txns: [signedTxn] })
      ],
      allowEmptySignatures: true,
      allowUnnamedResources: true,
      allowMoreLogging: true
    });
    const result = await algod.simulateTransactions(request).do();
    const logs = result.txnGroups?.[0]?.txnResults?.[0]?.txnResult?.logs ?? [];
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
function filterServices(services, options) {
  let results = [...services];
  if (options.name) {
    const nl = options.name.toLowerCase();
    results = results.filter(
      (s) => s.name.toLowerCase().includes(nl) || s.description.toLowerCase().includes(nl) || s.tags.some((tag) => tag.toLowerCase().includes(nl))
    );
  }
  if (options.tags?.length) {
    const tl = options.tags.map((t) => t.toLowerCase());
    results = results.filter(
      (s) => s.tags.some((tag) => tl.includes(tag.toLowerCase()))
    );
  }
  if (options.paymentToken) {
    results = results.filter((s) => s.paymentToken === options.paymentToken);
  }
  if (options.network) {
    results = results.filter((s) => s.network === options.network);
  }
  if (options.maxPrice) {
    const max = parseFloat(options.maxPrice);
    results = results.filter((s) => parseFloat(s.pricePerRequest) <= max);
  }
  return results;
}
var RegistryClient = class {
  algod;
  appId;
  network;
  indexerUrl;
  constructor(network = "testnet") {
    this.network = network;
    const algodUrl = network === "testnet" ? ALGOD_TESTNET_URL : ALGOD_MAINNET_URL;
    this.indexerUrl = network === "testnet" ? INDEXER_TESTNET_URL : INDEXER_MAINNET_URL;
    this.algod = new algosdk3.Algodv2("", algodUrl, "");
    this.appId = getRegistryAppId();
  }
  /** App ID of the registry contract. */
  getAppId() {
    return this.appId;
  }
  /** Fetches a specific service by developer address and name. */
  async findService(developerAddress, name) {
    const svc = await fetchServiceOnChain(
      this.algod,
      this.appId,
      developerAddress,
      name
    );
    return svc ?? void 0;
  }
  /**
   * Lists ALL services registered on-chain by enumerating the registry
   * contract's boxes via the Algorand Indexer, then reading each one.
   *
   * Box key format (binary): "svc:" + <32-byte pubkey> + ":" + <service_name>
   */
  async listAllServices() {
    const boxesUrl = `${this.indexerUrl}/v2/applications/${this.appId}/boxes`;
    const response = await fetch(boxesUrl);
    if (!response.ok) {
      throw new Error(
        `Indexer API error: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    const boxes = data.boxes ?? [];
    const servicePromises = [];
    for (const box of boxes) {
      try {
        const boxKeyBytes = Buffer.from(box.name, "base64");
        if (boxKeyBytes.slice(0, 4).toString("utf-8") !== "svc:") continue;
        if (boxKeyBytes.length < 4 + 32 + 1) continue;
        const pubkeyBytes = boxKeyBytes.slice(4, 36);
        if (pubkeyBytes.length !== 32) continue;
        if (boxKeyBytes[36] !== 58) continue;
        const serviceName = boxKeyBytes.slice(37).toString("utf-8");
        if (!serviceName) continue;
        const developerAddress = algosdk3.encodeAddress(pubkeyBytes);
        servicePromises.push(
          fetchServiceOnChain(
            this.algod,
            this.appId,
            developerAddress,
            serviceName
          )
        );
      } catch {
        continue;
      }
    }
    const services = await Promise.all(servicePromises);
    return services.filter((s) => s !== null);
  }
  /** Lists all services then applies search filters. */
  async search(options = {}) {
    const all = await this.listAllServices();
    return filterServices(all, { ...options, network: options.network ?? this.network });
  }
};

// src/tools/bazaar-search.ts
function toChainPeNetwork(network) {
  return network === "algorand" ? "mainnet" : "testnet";
}
function registerBazaarSearch(server2, config2) {
  server2.tool(
    "search_bazaar",
    "Discover x402-gated services registered on the ChainPe on-chain registry (Algorand). Returns each service with its description, price, tags, and the endpoint URL. To use a service, pass its endpoint to the `x402_fetch` tool, which handles the USDC/ALGO payment automatically.",
    {
      query: z6.string().optional().describe(
        'Optional keyword to filter by name, description, or tag (e.g. "weather", "btc", "chat")'
      ),
      tags: z6.array(z6.string()).optional().describe("Optional list of tags to filter by (matches any)"),
      maxPrice: z6.string().optional().describe('Optional maximum price per request as a decimal string, e.g. "0.05"')
    },
    async ({ query, tags, maxPrice }) => {
      const net = toChainPeNetwork(config2.network);
      try {
        const client = new RegistryClient(net);
        const services = await client.search({ name: query, tags, maxPrice });
        if (services.length === 0) {
          const where = query ? ` matching "${query}"` : "";
          return {
            content: [
              {
                type: "text",
                text: `No ChainPe services found${where} on ${net} (registry app ${client.getAppId()}).`
              }
            ]
          };
        }
        const serviceList = services.map(
          (s, i) => `${i + 1}. ${s.name} \u2014 ${s.description}
   Price: ${s.pricePerRequest} ${s.paymentToken}` + (s.tags.length ? `  \xB7  Tags: ${s.tags.join(", ")}` : "") + `
   Endpoint: ${s.endpoint}`
        ).join("\n\n");
        const header = query ? `Found ${services.length} ChainPe service(s) matching "${query}":` : `Found ${services.length} ChainPe service(s):`;
        const summary = `

\u{1F4CB} Network: ${net}  \xB7  Registry App: ${client.getAppId()}
Hint: call x402_fetch with a service's Endpoint to pay and fetch its result.`;
        return {
          content: [
            {
              type: "text",
              text: `${header}

${serviceList}${summary}`
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `ChainPe registry search failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        };
      }
    }
  );
}

// src/tools/request-funding.ts
import { z as z7 } from "zod";
var USDC_ASA5 = {
  algorand: 31566704,
  "algorand-testnet": 10458941
};
function registerRequestFunding(server2, config2) {
  server2.tool(
    "request_funding",
    "Generate an Algorand payment URI (deep-link) to ask a human or another agent to send USDC or ALGO to this wallet. Returns a clickable algorand:// link that opens directly in Pera Wallet on mobile. Use this when the wallet is low on funds.",
    {
      currency: z7.enum(["USDC", "ALGO"]).default("USDC").describe("Which currency to request \u2014 USDC (default) or native ALGO"),
      amount: z7.string().describe('Amount to request as decimal, e.g. "5.00" for $5 USDC or "2.5" for 2.5 ALGO'),
      note: z7.string().optional().describe('Optional message to include, e.g. "Agent needs gas for Weather API task"'),
      network: z7.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Network (default: algorand-testnet)")
    },
    async ({ currency, amount, note, network }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [{ type: "text", text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC." }],
          isError: true
        };
      }
      try {
        const address = await getWalletAddress(network, config2);
        const parts = amount.split(".");
        const whole = parts[0] || "0";
        const frac = (parts[1] || "").padEnd(6, "0").slice(0, 6);
        const microAmount = BigInt(whole) * 1000000n + BigInt(frac);
        const params = new URLSearchParams();
        params.set("amount", microAmount.toString());
        if (currency === "USDC") {
          const assetId = USDC_ASA5[network];
          params.set("asset", String(assetId));
        }
        if (note) {
          params.set("note", note);
          params.set("xnote", "1");
        }
        const uri = `algorand://${address}?${params.toString()}`;
        const peraLink = `https://app.perawallet.app/#${encodeURIComponent(uri)}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: `Please send ${amount} ${currency} to fund this agent wallet.`,
                  walletAddress: address,
                  currency,
                  amount: `${amount} ${currency}`,
                  network,
                  deepLink: uri,
                  peraWebLink: peraLink,
                  instructions: [
                    "\u{1F4F1} Mobile: Tap the deepLink on your phone to open directly in Pera Wallet",
                    "\u{1F4BB} Desktop: Open the peraWebLink in your browser",
                    "\u{1F4CB} Manual: Copy the walletAddress and send manually"
                  ]
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/spending-report.ts
function registerSpendingReport(server2, spending) {
  server2.tool(
    "spending_report",
    "Show a full breakdown of all payments this agent has made in the current session: how much was spent today, this session, remaining daily budget, and a history of all recent x402 payments and USDC transfers. Use this to audit your own spending.",
    {},
    async () => {
      try {
        const summary = spending.getSummary();
        const dailyLimit = parseFloat(summary.limits.maxPerDay);
        const spentToday = parseFloat(summary.spentToday);
        const remaining = Math.max(0, dailyLimit - spentToday);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  summary: {
                    spentToday: `$${summary.spentToday} USDC`,
                    spentThisSession: `$${summary.spentSession} USDC`,
                    remainingDailyBudget: `$${remaining.toFixed(4)} USDC`,
                    dailyLimit: `$${summary.limits.maxPerDay} USDC`,
                    perCallLimit: `$${summary.limits.maxPerCall} USDC`
                  },
                  recentPayments: summary.recentPayments.map((p) => ({
                    recipient: p.recipient,
                    amount: `$${p.amount} USDC`,
                    network: p.network,
                    time: p.timestamp
                  })),
                  totalPayments: summary.recentPayments.length
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true
        };
      }
    }
  );
}

// src/tools/create-token.ts
import { z as z8 } from "zod";
import algosdk4 from "algosdk";
var ALGOD_URLS4 = {
  algorand: "https://mainnet-api.algonode.cloud",
  "algorand-testnet": "https://testnet-api.algonode.cloud"
};
function registerCreateToken(server2, config2) {
  server2.tool(
    "create_token",
    "Mint a brand-new Algorand Standard Asset (ASA/token) from this agent wallet. Works exactly like creating an ERC-20, but at Layer-1 with no smart contracts required. Use this to launch a governance token, a memecoin, or a reward token for a community. The creator wallet automatically holds the entire supply and acts as manager.",
    {
      name: z8.string().max(32).describe('Full name of the token, e.g. "ClaudeAI Coin" (max 32 chars)'),
      ticker: z8.string().max(8).describe('Short ticker symbol, e.g. "CLAUDE" (max 8 chars)'),
      totalSupply: z8.number().int().positive().describe("Total number of tokens to create, e.g. 1000000 for 1 million"),
      decimals: z8.number().int().min(0).max(19).default(6).describe("Decimal precision (0 = NFT/whole units, 6 = like USDC, default: 6)"),
      url: z8.string().optional().describe("Optional URL for token info, e.g. your project website"),
      note: z8.string().optional().describe('Optional transaction note, e.g. "Launched by Claude Agent"'),
      freeze: z8.boolean().default(false).describe("If true, give the creator freeze/unfreeze powers over holders (default: false)"),
      network: z8.enum(["algorand", "algorand-testnet"]).default("algorand-testnet").describe("Network (default: algorand-testnet)")
    },
    async ({ name, ticker, totalSupply, decimals, url, note, freeze, network }) => {
      if (!config2.algorandMnemonic) {
        return {
          content: [{ type: "text", text: "No Algorand wallet configured. Set ALGORAND_MNEMONIC." }],
          isError: true
        };
      }
      try {
        const algodUrl = ALGOD_URLS4[network];
        const algodClient = new algosdk4.Algodv2("", algodUrl, "");
        const { sk, addr } = algosdk4.mnemonicToSecretKey(config2.algorandMnemonic);
        const creator = algosdk4.encodeAddress(addr.publicKey);
        const params = await algodClient.getTransactionParams().do();
        const txn = algosdk4.makeAssetCreateTxnWithSuggestedParamsFromObject({
          sender: creator,
          total: BigInt(totalSupply),
          decimals,
          defaultFrozen: false,
          assetName: name,
          unitName: ticker,
          assetURL: url,
          // Give manager powers to the creator so they can update/destroy the token
          manager: creator,
          reserve: creator,
          // Only set freeze/clawback if user explicitly requested it
          freeze: freeze ? creator : void 0,
          clawback: void 0,
          suggestedParams: params,
          note: note ? new TextEncoder().encode(note) : void 0
        });
        const signedTxn = algosdk4.signTransaction(txn, sk);
        const { txid } = await algodClient.sendRawTransaction(signedTxn.blob).do();
        const confirmation = await algosdk4.waitForConfirmation(algodClient, txid, 5);
        const assetId = Number(confirmation["asset-index"] ?? confirmation.assetIndex ?? 0);
        const explorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/asset/${assetId}` : `https://explorer.perawallet.app/asset/${assetId}`;
        const txExplorerUrl = network === "algorand-testnet" ? `https://testnet.explorer.perawallet.app/tx/${txid}` : `https://explorer.perawallet.app/tx/${txid}`;
        const displaySupply = decimals > 0 ? (totalSupply / Math.pow(10, decimals)).toLocaleString() + " " + ticker : totalSupply.toLocaleString() + " " + ticker;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `\u{1F389} Token "${name}" (${ticker}) successfully launched on ${network}!`,
                  token: {
                    name,
                    ticker,
                    assetId,
                    totalSupply: displaySupply,
                    decimals,
                    creator,
                    network,
                    url: url ?? null,
                    freezeEnabled: freeze
                  },
                  transactions: {
                    txid,
                    txExplorerUrl,
                    assetExplorerUrl: explorerUrl
                  },
                  nextSteps: [
                    `The entire supply of ${displaySupply} is now in your wallet.`,
                    `Other wallets must opt-in to ASA ID ${assetId} before they can receive tokens.`,
                    `Use transfer_usdc (for assets) or transfer_algo to distribute tokens.`
                  ]
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Token creation failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true
        };
      }
    }
  );
}

// src/server.ts
function createMcpServer(config2) {
  const server2 = new McpServer({
    name: "chainpe-wallet",
    version: "0.2.0"
  });
  const spending = new SpendingTracker(config2.budget);
  registerCheckBalance(server2, config2);
  registerTransferUsdc(server2, config2, spending);
  registerTransferAlgo(server2, config2);
  registerPay(server2, config2, spending);
  registerX402Fetch(server2, config2, spending);
  registerSpendingReport(server2, spending);
  registerRequestFunding(server2, config2);
  registerTinymanSwaps(server2, config2);
  registerCreateToken(server2, config2);
  registerBazaarSearch(server2, config2);
  return server2;
}

// src/index.ts
var _write = (msg, ...args) => process.stderr.write(`${[msg, ...args].join(" ")}
`);
console.log = _write;
console.info = _write;
console.debug = _write;
var config = loadConfig();
var server = createMcpServer(config);
var transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=index.js.map