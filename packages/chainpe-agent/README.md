# @chainpe/agent

**Pre-built AI Agent with x402 Payment Capabilities on Algorand**

ChainPe Agent is an AI agent SDK that can discover, pay for, and use monetized API services. Built on the Vercel AI SDK with support for OpenAI and Anthropic.

## Installation

```bash
npm install -g @chainpe/agent
```

Or as a library:

```bash
npm install @chainpe/agent
```

## Quick Start

### Prerequisites

Before you start, you'll need:
1. **LLM API Key** - Get a free Groq API key at https://console.groq.com/
2. **Testnet ALGO** - Fund your wallet at https://bank.testnet.algorand.network/
3. **Algorand Wallet** - Generate a new wallet or use existing 25-word mnemonic

### 1. Initialize Configuration

```bash
chainpe-agent init
```

This interactive wizard will ask you for:
- **LLM Mode**: Local (Ollama) or Cloud API
- **LLM Provider**: Groq (free), OpenAI, Anthropic, or Google Gemini
- **Model selection**: Recommended models shown first
- **API key**: Your LLM provider API key
- **Algorand wallet mnemonic**: 25-word phrase (for automatic payments)
- **Preferred payment token**: ALGO or USDC

### 2. Check Status

```bash
chainpe-agent status
```

### 3. Run Tasks

```bash
chainpe-agent run "Find a weather service and get the weather for San Francisco"
```

## Commands

| Command | Description |
|---------|-------------|
| `chainpe-agent init` | Interactive setup wizard |
| `chainpe-agent status` | Show config and wallet balance |
| `chainpe-agent services` | List available services |
| `chainpe-agent run <task>` | Execute a task with the agent |

## Programmatic Usage

```typescript
import { ChainPeAgent } from "@chainpe/agent";

// Create agent (reads config from ~/.chainpe/agent.json)
const agent = new ChainPeAgent();

// List available services
const services = await agent.listServices();
console.log(services);

// Run a task
const result = await agent.run(
  "Find a research service and summarize quantum computing",
  {
    maxSteps: 5,
    verbose: true,
    onPayment: (receipt) => {
      console.log(`Paid ${receipt.amount} ${receipt.token}`);
    }
  }
);

console.log(result.text);
console.log(`Total spent: ${result.payments.totalSpent.ALGO} ALGO`);
```

## How It Works

```
User Task → AI Agent → Discovers Services → Pays via x402 → Gets Response
                ↓
           On-Chain Registry (Algorand)
```

1. Agent receives a task from user
2. Agent queries on-chain registry for relevant services
3. Agent calls service, receives 402 Payment Required
4. Agent signs x402 payment authorization
5. Service returns data, agent processes and responds

## Configuration

The agent stores config in `~/.chainpe/agent.json`:

### Example: Using Groq (Free Tier)

```json
{
  "llm": {
    "mode": "api",
    "provider": "groq",
    "model": "qwen/qwen3-32b",
    "apiKey": "gsk_..."
  },
  "wallet": {
    "mnemonic": "your twenty five word algorand mnemonic phrase here...",
    "address": "YOUR_ALGO_ADDRESS..."
  },
  "payment": {
    "preferredToken": "ALGO"
  },
  "network": "testnet"
}
```

### Example: Using OpenAI

```json
{
  "llm": {
    "mode": "api",
    "provider": "openai",
    "model": "gpt-4o",
    "apiKey": "sk-..."
  },
  "wallet": {
    "mnemonic": "your twenty five word algorand mnemonic phrase here...",
    "address": "YOUR_ALGO_ADDRESS..."
  },
  "payment": {
    "preferredToken": "ALGO"
  },
  "network": "testnet"
}
```

### Example: Using Local Ollama

```json
{
  "llm": {
    "mode": "local",
    "provider": "openai",
    "model": "qwen2.5:7b",
    "apiKey": "ollama",
    "baseURL": "http://localhost:11434/v1"
  },
  "wallet": {
    "mnemonic": "your twenty five word algorand mnemonic phrase here...",
    "address": "YOUR_ALGO_ADDRESS..."
  },
  "payment": {
    "preferredToken": "ALGO"
  },
  "network": "testnet"
}
```

## Supported LLMs

- **Groq** (Recommended for free tier): llama-3.3-70b, qwen/qwen3-32b
- **OpenAI**: gpt-4o, gpt-4-turbo, gpt-3.5-turbo
- **Anthropic**: claude-3-5-sonnet, claude-3-opus, claude-3-sonnet
- **Google Gemini**: gemini-2.0-flash, gemini-1.5-pro
- **Local (Ollama)**: Any Ollama model (free, runs locally)

### Getting API Keys

- **Groq** (Free): https://console.groq.com/ - Fast inference, generous free tier
- **OpenAI**: https://platform.openai.com/api-keys
- **Anthropic**: https://console.anthropic.com/
- **Google AI**: https://aistudio.google.com/app/apikey

## Requirements

- Node.js >= 18
- LLM API key (Groq recommended for free tier) OR local Ollama installation
- Algorand wallet with testnet ALGO
- Get testnet ALGO: https://bank.testnet.algorand.network/

## License

MIT
