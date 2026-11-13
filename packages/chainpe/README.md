# @chainpeavax/cli

[![npm](https://img.shields.io/npm/v/@chainpeavax/cli.svg)](https://www.npmjs.com/package/@chainpeavax/cli)

**Monetize any API with x402 micropayments on Avalanche**

ChainPe is a reverse proxy that sits in front of your HTTP API and enforces x402 protocol payments on every request. One command, zero backend changes, real AVAX/USDC settlements on Avalanche.

## Installation

```bash
npm install -g @chainpeavax/cli
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
- Payment token (USDC)
- Your Avalanche wallet address (to receive payments)
- Optional: private key for on-chain registration

**Note:** The provider CLI only needs your **wallet address** to receive payments. The private key is only required if you want to register your service on-chain during setup. You can also skip registration and do it manually later.

### 2. Start the Proxy

```bash
chainpe start
```

Your API is now monetized! Every request to `http://localhost:4402/*` requires a micropayment.

### 3. Register Your Service (Optional)

Make your service discoverable by AI agents with on-chain registration. You have 3 options:

#### Option 1: QR Code with Core Wallet Mobile (Recommended) 📱

```bash
chainpe init
# Select "Scan QR code with Core Wallet mobile app"
```

1. A QR code will appear in your terminal
2. Open Core Wallet on your phone
3. Tap the WalletConnect icon (top right)
4. Scan the QR code
5. Approve the transaction (~1.5 USDC fee)
6. Done! Your service is registered on-chain

#### Option 2: Private key Phrase 🔑

```bash
chainpe init
# Select "Paste private key phrase"
```

Paste your private key (0x…) to sign the transaction directly.

**Getting your private key from Core Wallet:**
1. Open Core Wallet mobile app
2. Go to Settings → Account Settings
3. Select your account → Show Passphrase
4. Copy all a 0x private key in order

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
| `chainpe register` | Register service on Avalanche |
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
5. Response sent to client, payment settled on Avalanche

## Programmatic Usage

```typescript
import { startProxyServer } from "@chainpeavax/cli";

const handle = await startProxyServer({
  config: {
    targetUrl: "http://localhost:3000",
    pricePerRequest: "0.01",
    paymentToken: "AVAX",
    walletAddress: "YOUR_ADDRESS",
    proxyPort: 4402,
    network: "avalanche",
  }
});

console.log(`Proxy running at ${handle.url}`);
```

## Requirements

- Node.js >= 18
- Avalanche wallet with AVAX for gas

## License

MIT
