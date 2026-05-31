/**
 * ChainPe Wallet Connect Registration
 * 
 * Opens a local webpage where users can connect their Pera Wallet
 * and sign the registration transaction.
 */

import http from "http";
import algosdk from "algosdk";
import fs from "fs";
import path from "path";
import os from "os";
import type { PaymentToken } from "./types.js";
import open from "open";

// Default admin address - receives registration fees
// This can be overridden via CHAINPE_ADMIN_ADDRESS environment variable
const DEFAULT_ADMIN_ADDRESS = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
const ADMIN_ADDRESS = process.env.CHAINPE_ADMIN_ADDRESS || DEFAULT_ADMIN_ADDRESS;

const REGISTRATION_FEE = 1_000_000n; // 1 ALGO
const DEFAULT_APP_ID = 757478481n;

function readAppIdFromConfig(): bigint | undefined {
  try {
    const configPath = path.join(os.homedir(), ".chainpe", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { registryAppId?: string };
    if (config.registryAppId) return BigInt(config.registryAppId);
  } catch {
    // Ignore invalid/missing config and use fallback
  }
  return undefined;
}

function getRegistryAppId(): bigint {
  const envId = process.env.CHAINPE_REGISTRY_APP_ID;
  if (envId) return BigInt(envId);
  return readAppIdFromConfig() ?? DEFAULT_APP_ID;
}

export interface WalletRegistrationParams {
  walletAddress: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: PaymentToken;
  network: "testnet" | "mainnet";
}

/**
 * Opens a browser page for wallet-based registration.
 * Returns a promise that resolves with the transaction hash when complete.
 */
export async function registerWithWallet(params: WalletRegistrationParams): Promise<{
  success: boolean;
  txnHash?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const PORT = 14402;
    
    const html = generateRegistrationPage(params, PORT);
    
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else if (req.method === "GET" && req.url === "/params") {
        res.writeHead(200, { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(JSON.stringify(params));
      } else if (req.method === "POST" && req.url === "/complete") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          res.writeHead(200, { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(JSON.stringify({ ok: true }));
          
          try {
            const result = JSON.parse(body);
            server.close();
            resolve(result);
          } catch {
            server.close();
            resolve({ success: false, error: "Invalid response" });
          }
        });
      } else if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end();
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    
    server.listen(PORT, async () => {
      console.log(`\n  Opening browser for wallet connection...`);
      await open(`http://localhost:${PORT}`);
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      resolve({ success: false, error: "Registration timed out" });
    }, 5 * 60 * 1000);
  });
}

function generateRegistrationPage(params: WalletRegistrationParams, port: number): string {
  const appId = getRegistryAppId();
  const appAddress = algosdk.getApplicationAddress(appId).toString();
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="name" content="ChainPe">
  <title>ChainPe - Register Service</title>
  <!-- Pera Wallet Connect CSS - REQUIRED for modal to display -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@perawallet/connect@1.3.4/dist/index.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    /* Ensure Pera modal appears on top */
    .pera-wallet-modal {
      z-index: 9999 !important;
    }
    .container {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 24px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .logo {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(90deg, #00D9FF, #00FF94, #FFD93D);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-align: center;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #888;
      text-align: center;
      margin-bottom: 32px;
    }
    .service-info {
      background: rgba(0, 217, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .service-info h3 {
      color: #00D9FF;
      margin-bottom: 12px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      color: #ccc;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #888; }
    .info-value { color: #fff; font-weight: 500; }
    .btn {
      width: 100%;
      padding: 16px 24px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      margin-bottom: 12px;
    }
    .btn-primary {
      background: linear-gradient(90deg, #00D9FF, #00FF94);
      color: #000;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 217, 255, 0.3);
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }
    .status {
      text-align: center;
      padding: 16px;
      border-radius: 12px;
      margin-top: 16px;
    }
    .status.success {
      background: rgba(0, 255, 148, 0.1);
      color: #00FF94;
    }
    .status.error {
      background: rgba(255, 100, 100, 0.1);
      color: #ff6464;
    }
    .status.pending {
      background: rgba(255, 217, 61, 0.1);
      color: #FFD93D;
    }
    .hidden { display: none; }
    .wallet-address {
      font-family: monospace;
      font-size: 12px;
      word-break: break-all;
    }
    .fee-notice {
      background: rgba(255, 217, 61, 0.1);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 24px;
      color: #FFD93D;
      font-size: 14px;
      text-align: center;
    }
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">ChainPe</div>
    <div class="subtitle">Register Your Service On-Chain</div>
    
    <div class="service-info">
      <h3>Service Details</h3>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${params.name}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Price</span>
        <span class="info-value">${params.pricePerRequest} ${params.paymentToken}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Endpoint</span>
        <span class="info-value" style="font-size: 12px">${params.endpoint}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Network</span>
        <span class="info-value">${params.network}</span>
      </div>
    </div>
    
    <div class="fee-notice">
      Registration fee: ~1.5 ALGO (1 ALGO fee + storage)
    </div>
    
    <div id="connect-section">
      <button class="btn btn-primary" id="connect-btn">
        Connect Pera Wallet
      </button>
    </div>
    
    <div id="sign-section" class="hidden">
      <div class="info-row" style="margin-bottom: 16px">
        <span class="info-label">Connected</span>
        <span class="info-value wallet-address" id="wallet-address"></span>
      </div>
      <button class="btn btn-primary" id="sign-btn">
        Sign & Register
      </button>
      <button class="btn btn-secondary" id="disconnect-btn">
        Disconnect
      </button>
    </div>
    
    <div id="status" class="status hidden"></div>
  </div>

  <!-- Load algosdk from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/algosdk@2.7.0/dist/browser/algosdk.min.js"></script>
  <!-- Load Pera Wallet Connect UMD bundle -->
  <script src="https://cdn.jsdelivr.net/npm/@perawallet/connect@1.3.4/dist/index.umd.js"></script>
  
  <script>
    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
      const params = ${JSON.stringify(params)};
      const appId = ${appId.toString()}n;
      const appAddress = "${appAddress}";
      const adminAddress = "${ADMIN_ADDRESS}";
      const registrationFee = ${REGISTRATION_FEE.toString()}n;
      const port = ${port};
      
      let peraWallet = null;
      let connectedAddress = null;
      
      // Initialize Pera Wallet - access from global PeraWalletConnect namespace
      const PeraWalletConnect = window.PeraWalletConnect.PeraWalletConnect;
      peraWallet = new PeraWalletConnect({
        shouldShowSignTxnToast: true,
        chainId: 416002, // TestNet
      });
      
      console.log('Pera Wallet initialized:', peraWallet);
      
      // Reconnect if session exists
      peraWallet.reconnectSession().then((accounts) => {
        console.log('Reconnect session result:', accounts);
        if (accounts.length > 0) {
          connectedAddress = accounts[0];
          showConnected();
        }
      }).catch((err) => {
        console.log('Reconnect error (this is normal if no previous session):', err);
      });
      
      // Connect button handler
      document.getElementById('connect-btn').addEventListener('click', async () => {
        try {
          setStatus('<span class="loading"></span> Opening Pera Wallet...', 'pending');
          console.log('Calling peraWallet.connect()...');
          
          const accounts = await peraWallet.connect();
          console.log('Connected accounts:', accounts);
          connectedAddress = accounts[0];
          showConnected();
          
          setStatus('Wallet connected! Click "Sign & Register" to continue.', 'success');
        } catch (error) {
          console.error('Connect error:', error);
          if (error?.data?.type === 'CONNECT_MODAL_CLOSED') {
            setStatus('Connection cancelled - modal closed.', 'error');
          } else if (error.message?.includes('cancelled')) {
            setStatus('Connection cancelled by user.', 'error');
          } else {
            setStatus('Failed to connect: ' + (error.message || error), 'error');
          }
        }
    });
    
    // Disconnect button handler
    document.getElementById('disconnect-btn').addEventListener('click', () => {
      if (peraWallet) {
        peraWallet.disconnect();
      }
      connectedAddress = null;
      document.getElementById('connect-section').classList.remove('hidden');
      document.getElementById('sign-section').classList.add('hidden');
      document.getElementById('status').classList.add('hidden');
    });
    
    // Sign button handler  
    document.getElementById('sign-btn').addEventListener('click', async () => {
      if (!connectedAddress) {
        setStatus('Please connect wallet first', 'error');
        return;
      }
      
      const btn = document.getElementById('sign-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading"></span> Processing...';
      
      try {
        setStatus('<span class="loading"></span> Building transaction...', 'pending');
        
        // Connect to Algorand testnet node
        const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');
        const sp = await algodClient.getTransactionParams().do();
        
        // Build box key for storage
        const boxKey = buildBoxKey(connectedAddress, params.name);
        
        // Calculate Minimum Balance Requirement for box storage
        const nameBytes = new TextEncoder().encode(params.name);
        const boxKeySize = 4 + 32 + 1 + nameBytes.length;
        const boxValueSize = 1024;
        const boxMbr = BigInt(2500 + 400 * (boxKeySize + boxValueSize));
        
        // Build method selector for register()
        const methodSig = 'register(pay,string,string,string,string,string,string,string,string)void';
        const selector = new Uint8Array(
          algosdk.ABIMethod.fromSignature(methodSig).getSelector()
        );
        
        // Build app args with ARC-4 encoding
        const appArgs = [
          selector,
          encodeArc4String(params.name),
          encodeArc4String(params.description),
          encodeArc4String(params.tags.join(', ')),
          encodeArc4String(params.endpoint),
          encodeArc4String(params.pricePerRequest),
          encodeArc4String(params.paymentToken),
          encodeArc4String(params.walletAddress),
          encodeArc4String(params.network),
        ];
        
        // Transaction 1: Fund app for box storage MBR
        const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: connectedAddress,
          to: appAddress,
          amount: boxMbr,
          suggestedParams: sp,
        });
        
        // Transaction 2: Pay admin registration fee (1 ALGO)
        const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: connectedAddress,
          to: adminAddress,
          amount: registrationFee,
          suggestedParams: sp,
        });
        
        // Transaction 3: Application call to register
        const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
          from: connectedAddress,
          appIndex: appId,
          appArgs: appArgs,
          boxes: [{ appIndex: appId, name: boxKey }],
          suggestedParams: { ...sp, fee: 2000, flatFee: true },
        });
        
        // Group the transactions
        const txnGroup = [fundTxn, payTxn, appCallTxn];
        algosdk.assignGroupID(txnGroup);
        
        setStatus('<span class="loading"></span> Please approve in Pera Wallet...', 'pending');
        
        // Request signature from Pera Wallet
        const signedTxns = await peraWallet.signTransaction([
          txnGroup.map(txn => ({ txn, signers: [connectedAddress] }))
        ]);
        
        setStatus('<span class="loading"></span> Submitting to Algorand...', 'pending');
        
        // Submit the signed transactions
        const { txId } = await algodClient.sendRawTransaction(signedTxns).do();
        
        setStatus('<span class="loading"></span> Waiting for confirmation...', 'pending');
        
        // Wait for confirmation
        await algosdk.waitForConfirmation(algodClient, txId, 8);
        
        setStatus('✓ Service registered successfully!<br><small>TX: ' + txId.slice(0, 20) + '...</small>', 'success');
        
        // Notify CLI server
        await fetch('http://localhost:' + port + '/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, txnHash: txId })
        });
        
        btn.innerHTML = '✓ Registered!';
        btn.disabled = true;
        
        // Auto-close after 3 seconds
        setTimeout(() => {
          document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#00FF94;font-size:24px;">✓ You can close this window</div>';
        }, 2000);
        
      } catch (error) {
        console.error('Registration error:', error);
        btn.disabled = false;
        btn.innerHTML = 'Sign & Register';
        
        let errorMsg = error.message || String(error);
        if (errorMsg.includes('cancelled') || errorMsg.includes('rejected')) {
          errorMsg = 'Transaction cancelled by user';
        }
        
        setStatus('Failed: ' + errorMsg, 'error');
        
        // Notify CLI server of failure
        await fetch('http://localhost:' + port + '/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: errorMsg })
        });
      }
    });
    
    function showConnected() {
      document.getElementById('wallet-address').textContent = 
        connectedAddress.slice(0, 8) + '...' + connectedAddress.slice(-4);
      document.getElementById('connect-section').classList.add('hidden');
      document.getElementById('sign-section').classList.remove('hidden');
    }
    
    function buildBoxKey(senderAddr, serviceName) {
      const prefix = new TextEncoder().encode('svc:');
      const senderBytes = algosdk.decodeAddress(senderAddr).publicKey;
      const colon = new TextEncoder().encode(':');
      const nameBytes = new TextEncoder().encode(serviceName);
      const key = new Uint8Array(prefix.length + senderBytes.length + colon.length + nameBytes.length);
      let pos = 0;
      key.set(prefix, pos); pos += prefix.length;
      key.set(senderBytes, pos); pos += senderBytes.length;
      key.set(colon, pos); pos += colon.length;
      key.set(nameBytes, pos);
      return key;
    }
    
    function encodeArc4String(s) {
      const utf8 = new TextEncoder().encode(s);
      const buf = new Uint8Array(2 + utf8.length);
      new DataView(buf.buffer).setUint16(0, utf8.length, false);
      buf.set(utf8, 2);
      return buf;
    }
    
    function setStatus(message, type) {
      const el = document.getElementById('status');
      el.innerHTML = message;
      el.className = 'status ' + type;
      el.classList.remove('hidden');
    }
    
    }); // End DOMContentLoaded
  </script>
</body>
</html>`;
}
