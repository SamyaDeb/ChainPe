/**
 * Browser / MetaMask registration handoff.
 *
 * Instead of pasting a private key into the terminal, the developer signs the
 * on-chain registration in their browser wallet (MetaMask / Core / any injected
 * EIP-1193 wallet). The CLI:
 *   1. starts an ephemeral localhost server,
 *   2. opens the browser to a signing page,
 *   3. the page connects the wallet, switches to Avalanche, runs USDC `approve`
 *      (if a fee is required) then `register`/`update` on ChainPeRegistry,
 *   4. the page POSTs the resulting tx hash back; the CLI prints it and exits.
 *
 * The provider's private key never leaves their wallet.
 */

import http from "http";
import { exec } from "child_process";
import { getNetwork, type ChainPeNetwork } from "./chains.js";
import { logger } from "./logger.js";

export interface BrowserRegisterParams {
  registryAddress: string;
  network: ChainPeNetwork;
  /** The provider's wallet — must match the connected account (it becomes the on-chain developer). */
  walletAddress: string;
  name: string;
  description: string;
  tags: string[];
  endpoint: string;
  pricePerRequest: string;
  paymentToken: string;
  agentId?: string;
  isUpdate?: boolean;
}

export interface BrowserRegisterResult {
  success: boolean;
  txnHash?: string;
  developer?: string;
  error?: string;
}

function openBrowser(url: string): void {
  if (process.env.CHAINPE_NO_OPEN) return; // testing / headless
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      logger.warn(`Could not open the browser automatically. Open this URL manually:\n  ${url}`);
    }
  });
}

export async function registerViaBrowser(
  params: BrowserRegisterParams
): Promise<BrowserRegisterResult> {
  const info = getNetwork(params.network);

  const pageConfig = {
    fn: params.isUpdate ? "update" : "register",
    registryAddress: params.registryAddress,
    expectedDeveloper: params.walletAddress,
    chainId: info.chainId,
    chainIdHex: "0x" + info.chainId.toString(16),
    chainName: params.network === "fuji" ? "Avalanche Fuji C-Chain" : "Avalanche C-Chain",
    rpcUrl: info.rpcUrl,
    explorer: info.explorer,
    input: {
      name: params.name,
      description: params.description,
      tags: params.tags.join(", "),
      endpoint: params.endpoint,
      pricePerRequest: params.pricePerRequest,
      paymentToken: params.paymentToken,
      network: params.network,
      payTo: params.walletAddress,
      agentId: params.agentId ?? "0",
    },
  };

  return new Promise<BrowserRegisterResult>((resolve) => {
    let settled = false;
    const finish = (r: BrowserRegisterResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Allow the success/error response to flush before closing.
      setTimeout(() => server.close(), 250);
      resolve(r);
    };

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage(pageConfig));
        return;
      }
      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          try {
            const data = JSON.parse(body || "{}");
            if (data.error) finish({ success: false, error: String(data.error) });
            else finish({ success: true, txnHash: data.txHash, developer: data.developer });
          } catch {
            finish({ success: false, error: "Malformed callback from browser" });
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const timer = setTimeout(
      () => finish({ success: false, error: "Timed out waiting for browser signature (5 min)" }),
      5 * 60 * 1000
    );

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}/`;
      logger.info(`Opening browser to sign the transaction…\n  ${url}`);
      openBrowser(url);
    });

    server.on("error", (e) => finish({ success: false, error: e.message }));
  });
}

// ============================================================================
// Signing page (ethers v6 via CDN + injected wallet)
// ============================================================================

function renderPage(cfg: Record<string, unknown>): string {
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ChainPe — Sign Registration</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; background:#0b0d12; color:#e6e9ef; display:flex; min-height:100vh; align-items:center; justify-content:center; }
  .card { width:min(560px,92vw); background:#141822; border:1px solid #232a38; border-radius:16px; padding:32px; }
  h1 { margin:0 0 4px; font-size:20px; } .sub { color:#8b94a7; font-size:13px; margin-bottom:20px; }
  .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #1d2330; font-size:14px; }
  .row .k { color:#8b94a7; } .row .v { font-weight:600; text-align:right; max-width:60%; overflow-wrap:anywhere; }
  button { width:100%; margin-top:22px; padding:14px; border:0; border-radius:12px; font-size:15px; font-weight:700; cursor:pointer;
    background:linear-gradient(90deg,#E84142,#FF6B6B); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  #status { margin-top:18px; font-size:13px; color:#8b94a7; min-height:20px; white-space:pre-wrap; }
  .ok { color:#36d399 !important; } .err { color:#ff6b6b !important; }
  a { color:#7cc4ff; }
</style>
</head>
<body>
  <div class="card">
    <h1>ChainPe — Register Service</h1>
    <div class="sub">Confirm the transaction in your wallet to publish your service on-chain.</div>
    <div class="row"><span class="k">Service</span><span class="v" id="f-name"></span></div>
    <div class="row"><span class="k">Price</span><span class="v" id="f-price"></span></div>
    <div class="row"><span class="k">Endpoint</span><span class="v" id="f-endpoint"></span></div>
    <div class="row"><span class="k">Network</span><span class="v" id="f-network"></span></div>
    <div class="row"><span class="k">Registry</span><span class="v" id="f-registry"></span></div>
    <button id="go">Connect wallet &amp; register</button>
    <div id="status"></div>
  </div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js"></script>
<script>
const CFG = ${json};
const $ = (id) => document.getElementById(id);
$("f-name").textContent = CFG.input.name;
$("f-price").textContent = CFG.input.pricePerRequest + " " + CFG.input.paymentToken;
$("f-endpoint").textContent = CFG.input.endpoint;
$("f-network").textContent = CFG.chainName;
$("f-registry").textContent = CFG.registryAddress;

const setStatus = (m, cls) => { const s = $("status"); s.textContent = m; s.className = cls || ""; };
const post = (payload) => fetch("/callback", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) }).catch(()=>{});

const REGISTRY_ABI = [
  "function registrationFee() view returns (uint256)",
  "function feeToken() view returns (address)",
  "function register((string name,string description,string tags,string endpoint,string pricePerRequest,string paymentToken,string network,address payTo,uint256 agentId) input) returns (bytes32)",
  "function update((string name,string description,string tags,string endpoint,string pricePerRequest,string paymentToken,string network,address payTo,uint256 agentId) input) returns (bytes32)"
];
const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

async function ensureChain() {
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CFG.chainIdHex }] });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
        chainId: CFG.chainIdHex, chainName: CFG.chainName,
        nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
        rpcUrls: [CFG.rpcUrl], blockExplorerUrls: [CFG.explorer]
      }]});
    } else { throw e; }
  }
}

$("go").onclick = async () => {
  $("go").disabled = true;
  try {
    if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or Core.");
    setStatus("Connecting wallet…");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    await ensureChain();
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    if (addr.toLowerCase() !== CFG.expectedDeveloper.toLowerCase()) {
      throw new Error("Connected account " + addr + " does not match your configured wallet " + CFG.expectedDeveloper + ". Switch accounts in your wallet.");
    }

    const registry = new ethers.Contract(CFG.registryAddress, REGISTRY_ABI, signer);
    const fee = await registry.registrationFee();
    if (fee > 0n) {
      const token = await registry.feeToken();
      const usdc = new ethers.Contract(token, ERC20_ABI, signer);
      const allowance = await usdc.allowance(addr, CFG.registryAddress);
      if (allowance < fee) {
        setStatus("Approve USDC registration fee in your wallet…");
        const a = await usdc.approve(CFG.registryAddress, fee);
        await a.wait();
      }
    }

    setStatus("Confirm the registration transaction in your wallet…");
    const tx = await registry[CFG.fn](CFG.input);
    setStatus("Submitted " + tx.hash + "\\nWaiting for confirmation…");
    await tx.wait();
    setStatus("✓ Registered on-chain!\\nTx: " + tx.hash, "ok");
    await post({ txHash: tx.hash, developer: addr });
  } catch (e) {
    const msg = (e && (e.shortMessage || e.message)) || String(e);
    setStatus("✗ " + msg, "err");
    await post({ error: msg });
    $("go").disabled = false;
  }
};
</script>
</body>
</html>`;
}
