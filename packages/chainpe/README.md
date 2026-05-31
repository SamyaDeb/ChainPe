# @chainpe/cli

**Monetize any API with x402 micropayments on Algorand**

ChainPe is a reverse proxy that sits in front of your HTTP API and enforces x402 protocol payments on every request. One command, zero backend changes, real ALGO/USDC settlements on Algorand.

## Installation

```bash
npm install -g @chainpe/cli
```

## Quick Start

### 1. Initialize Configuration

```bash
chainpe init
```

This interactive wizard will ask you for:
- Your API URL (the backend to monetize)
- Service name and description
- Price per request
- Payment token (ALGO or USDC)
- Your Algorand wallet address (to receive payments)
- Optional: 25-word mnemonic for on-chain registration

**Note:** The provider CLI only needs your **wallet address** to receive payments. The mnemonic is only required if you want to register your service on-chain during setup. You can also skip registration and do it manually later.

### 2. Start the Proxy

```bash
chainpe start
```

Your API is now monetized! Every request to `http://localhost:4402/*` requires a micropayment.

### 3. Register Your Service (Optional)

Make your service discoverable by AI agents with on-chain registration. You have 3 options:

#### Option 1: QR Code with Pera Wallet Mobile (Recommended) 📱

```bash
chainpe init
# Select "Scan QR code with Pera Wallet mobile app"
```

1. A QR code will appear in your terminal
2. Open Pera Wallet on your phone
3. Tap the WalletConnect icon (top right)
4. Scan the QR code
5. Approve the transaction (~1.5 ALGO fee)
6. Done! Your service is registered on-chain

#### Option 2: Mnemonic Phrase 🔑

```bash
chainpe init
# Select "Paste 25-word mnemonic phrase"
```

Paste your 25-word recovery phrase to sign the transaction directly.

**Getting your mnemonic from Pera Wallet:**
1. Open Pera Wallet mobile app
2. Go to Settings → Account Settings
3. Select your account → Show Passphrase
4. Copy all 25 words in order

#### Option 3: Manual Registration Later ⏭️

Skip registration during init and do it later:

```bash
chainpe register
```

## Commands

| Command | Description |
|---------|-------------|
| `chainpe init` | Interactive setup wizard |
| `chainpe start` | Start the x402 payment proxy |
| `chainpe register` | Register service on Algorand |
| `chainpe list` | List registered services |
| `chainpe status` | Show current config and wallet balance |

## How It Works

```
Client Request → ChainPe Proxy → 402 Payment Required
                     ↓
Client Signs Payment → Proxy Verifies → Forwards to Your API
                                              ↓
                                      Response + Settlement
```

1. Client makes request to proxy
2. Proxy returns 402 with payment instructions
3. Client signs x402 payment authorization
4. Proxy verifies signature, forwards request to your API
5. Response sent to client, payment settled on Algorand

## Programmatic Usage

```typescript
import { startProxyServer } from "@chainpe/cli";

const handle = await startProxyServer({
  config: {
    targetUrl: "http://localhost:3000",
    pricePerRequest: "0.01",
    paymentToken: "ALGO",
    walletAddress: "YOUR_ADDRESS",
    proxyPort: 4402,
    network: "testnet",
  }
});

console.log(`Proxy running at ${handle.url}`);
```

## Requirements

- Node.js >= 18
- Algorand wallet with testnet ALGO for gas
- Get testnet ALGO: https://bank.testnet.algorand.network/

## License

MIT
