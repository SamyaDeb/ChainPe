# ChainPe Consumer Developer Setup

**Build AI agents that can autonomously discover, pay for, and use monetized APIs with real ALGO payments.**

---

## 🚀 5-Minute Setup

### Step 1: Install ChainPe Agent

```bash
npm install -g @chainpe/agent
```

Or use it as a library in your project:

```bash
npm install @chainpe/agent
```

### Step 2: Get a Free LLM API Key

We recommend **Groq** for the free tier with fast inference:

1. Visit https://console.groq.com/
2. Sign up for free account
3. Go to API Keys section
4. Click "Create API Key"
5. Copy your key (starts with `gsk_...`)

**Alternative LLM Providers:**
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/
- Google AI: https://aistudio.google.com/app/apikey
- Local Ollama: Install from https://ollama.com/

### Step 3: Get Testnet ALGO

Your agent needs ALGO to pay for services:

1. Generate a new Algorand wallet OR use an existing one
2. Visit the testnet faucet: https://bank.testnet.algorand.network/
3. Paste your wallet address
4. Click "Dispense" to receive 10 testnet ALGO

**Need a new wallet?** You can generate one during the setup process or use any Algorand wallet app.

### Step 4: Initialize Your Agent

```bash
chainpe-agent init
```

The interactive setup will guide you through:

```
? LLM Mode › API (OpenAI/Anthropic/Groq/Gemini)
? LLM Provider › Groq (recommended for free tier)
? Model › qwen/qwen3-32b (recommended)
? Groq API Key › gsk_... (paste your key)
? Algorand Mnemonic › (paste your 25-word phrase)
✓ Wallet: IF2GKAR4...25NG6M
✓ Balance: 10 ALGO, 0 USDC
? Preferred Payment Token › ALGO
? Network › testnet
```

### Step 5: Test Your Agent!

```bash
chainpe-agent run "Get weather for London"
```

**Expected output:**
```
✓ Task completed

Here is the current weather information for London:
- Temperature: 58°F  
- Condition: Rainy 🌧️  
- Humidity: 85%  
- Wind Speed: 15 mph  

  Payments:
    Transactions: 1
    Total ALGO:   0.05
```

Your agent just discovered a service, paid 0.05 ALGO, and got the data - all automatically! 🎉

---

## 📖 CLI Commands

| Command | Description | Example |
|---------|-------------|---------|
| `chainpe-agent init` | Interactive setup wizard | `chainpe-agent init` |
| `chainpe-agent status` | Show config, wallet balance | `chainpe-agent status` |
| `chainpe-agent services` | List available paid services | `chainpe-agent services` |
| `chainpe-agent run <task>` | Execute a task | `chainpe-agent run "analyze data"` |
| `chainpe-agent run <task> --provider <name>` | Use specific service | `chainpe-agent run "get weather" --provider Weather` |
| `chainpe-agent run <task> --verbose` | Show payment details | `chainpe-agent run "task" --verbose` |

---

## 💻 SDK Usage (Programmatic)

### Basic Usage

```typescript
import { ChainPeAgent } from "@chainpe/agent";

// Create agent (reads config from ~/.chainpe/agent.json)
const agent = new ChainPeAgent();

// Run a task
const result = await agent.run("Get weather for Tokyo");

console.log(result.text);
console.log(`Spent: ${result.payments.totalSpent.ALGO} ALGO`);
```

### Advanced Usage with Options

```typescript
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent();

// Run with options
const result = await agent.run(
  "Find a research service and summarize quantum computing",
  {
    maxSteps: 10,
    verbose: true,
    onPayment: (receipt) => {
      console.log(`💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`);
      console.log(`   Transaction: ${receipt.transactionId}`);
    },
    onToolCall: (tool, args) => {
      console.log(`🔧 Using tool: ${tool}`);
    }
  }
);

// Check results
console.log("Response:", result.text);
console.log("Steps taken:", result.steps);
console.log("Total payments:", result.payments.transactions.length);
console.log("Total ALGO spent:", result.payments.totalSpent.ALGO);
console.log("Total USDC spent:", result.payments.totalSpent.USDC);
```

### Custom Configuration

```typescript
import { ChainPeAgent } from "@chainpe/agent";

// Override config file with custom settings
const agent = new ChainPeAgent({
  llm: {
    mode: "api",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    apiKey: process.env.GROQ_API_KEY!
  },
  wallet: {
    mnemonic: process.env.ALGO_MNEMONIC!,
  },
  payment: {
    preferredToken: "ALGO"
  },
  network: "testnet"
});

const result = await agent.run("Get weather data");
```

### Listing Available Services

```typescript
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent();

// List all services
const services = await agent.listServices();

services.forEach(service => {
  console.log(`${service.name}: ${service.description}`);
  console.log(`  Endpoint: ${service.endpoint}`);
  console.log(`  Price: ${service.pricePerRequest} ${service.paymentToken}`);
  console.log(`  Tags: ${service.tags.join(", ")}`);
  console.log();
});
```

---

## 🔧 Configuration Reference

### Config File Location

`~/.chainpe/agent.json`

### Config Structure

```typescript
{
  llm: {
    mode: "api" | "local",           // Cloud API or local Ollama
    provider: "groq" | "openai" | "anthropic" | "gemini",
    model: string,                    // Model name
    apiKey: string,                   // API key (not needed for local)
    baseURL?: string                  // Optional custom endpoint
  },
  wallet: {
    mnemonic: string,                 // 25-word Algorand mnemonic
    address?: string                  // Auto-derived from mnemonic
  },
  payment: {
    preferredToken: "ALGO" | "USDC"  // Payment preference
  },
  network: "testnet" | "mainnet",    // Algorand network
  registryPath?: string               // Custom registry location
}
```

### Supported Models

**Groq (Free Tier):**
- `llama-3.3-70b-versatile` - Best reasoning, slower
- `qwen/qwen3-32b` - Fast inference (recommended)
- `mixtral-8x7b-32768` - Good balance

**OpenAI:**
- `gpt-4o` - Most capable
- `gpt-4-turbo` - Fast GPT-4
- `gpt-3.5-turbo` - Fastest, cheapest

**Anthropic:**
- `claude-3-5-sonnet-20241022` - Most capable
- `claude-3-opus-20240229` - Best reasoning
- `claude-3-sonnet-20240229` - Balanced

**Google Gemini:**
- `gemini-2.0-flash-exp` - Fastest
- `gemini-1.5-pro` - Most capable

**Local Ollama:**
- `qwen2.5:7b` - Recommended for local
- `llama3.2:3b` - Lightweight
- Any model available in Ollama

---

## 🎯 Example Agent Scripts

### Weather Query Agent

```typescript
// weather-agent.ts
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent();

const cities = ["London", "Paris", "Tokyo", "New York", "Dubai"];

for (const city of cities) {
  console.log(`\n🌍 Getting weather for ${city}...`);
  
  const result = await agent.run(
    `Get current weather for ${city}`,
    { verbose: false }
  );
  
  console.log(result.text);
  console.log(`💰 Spent: ${result.payments.totalSpent.ALGO} ALGO`);
}

console.log("\n✅ All queries completed!");
```

Run with:
```bash
npx tsx weather-agent.ts
```

### Research Assistant Agent

```typescript
// research-agent.ts
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent();

const topics = [
  "Latest developments in quantum computing",
  "Climate change impact on agriculture",
  "Advances in gene therapy"
];

for (const topic of topics) {
  console.log(`\n📚 Researching: ${topic}`);
  
  const result = await agent.run(
    `Find research services and summarize: ${topic}`,
    { maxSteps: 5 }
  );
  
  console.log(result.text);
  console.log(`\nPayments: ${result.payments.transactions.length} transactions`);
}
```

### Multi-Service Agent

```typescript
// multi-service-agent.ts
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent();

async function runTask(task: string) {
  console.log(`\n🤖 Task: ${task}`);
  
  const result = await agent.run(task, {
    verbose: true,
    onPayment: (receipt) => {
      console.log(`  💳 Payment: ${receipt.amount} ${receipt.token}`);
    }
  });
  
  console.log(`\n📝 Result: ${result.text}`);
  console.log(`💰 Total spent: ${result.payments.totalSpent.ALGO} ALGO`);
}

// Run multiple tasks
await runTask("Get weather for San Francisco");
await runTask("Find news about AI and blockchain");
await runTask("Get stock data for AAPL");

console.log("\n✅ All tasks completed!");
```

---

## 🔐 Security Best Practices

### Wallet Security

1. **Never commit your mnemonic** to version control
2. **Use environment variables** for production:
   ```bash
   export ALGO_MNEMONIC="your 25 words here"
   ```
3. **Use testnet for development** - mainnet for production only
4. **Monitor wallet balance** to prevent unauthorized spending

### API Key Security

1. **Never commit API keys** to repositories
2. **Use environment variables**:
   ```bash
   export GROQ_API_KEY="gsk_..."
   ```
3. **Rotate keys regularly**
4. **Set spending limits** on your LLM provider dashboard

### Example: Secure Configuration

```typescript
import { ChainPeAgent } from "@chainpe/agent";

const agent = new ChainPeAgent({
  llm: {
    mode: "api",
    provider: "groq",
    model: "qwen/qwen3-32b",
    apiKey: process.env.GROQ_API_KEY!, // From env var
  },
  wallet: {
    mnemonic: process.env.ALGO_MNEMONIC!, // From env var
  },
  network: "testnet"
});
```

---

## 🐛 Troubleshooting

### "API key is invalid"
- Check your API key is correct
- Verify you're using the right provider (groq/openai/anthropic)
- Regenerate key if needed

### "Invalid mnemonic"
- Ensure 25 words separated by spaces
- Check for typos or extra spaces
- Verify it's an Algorand wallet (not Ethereum, etc.)

### "Insufficient balance"
- Get more testnet ALGO from https://bank.testnet.algorand.network/
- Check balance: `chainpe-agent status`
- Minimum 0.1 ALGO recommended

### "Service not found"
- Check services: `chainpe-agent services`
- Verify service is registered
- Try without `--provider` flag to auto-discover

### "Payment failed"
- Check wallet has sufficient ALGO
- Verify network connectivity
- Check service is accepting payments

---

## 📚 Next Steps

1. **Build your first agent** - Start with simple queries
2. **Explore available services** - `chainpe-agent services`
3. **Create custom workflows** - Combine multiple service calls
4. **Deploy to production** - Switch to mainnet when ready

## 🤝 Need Help?

- **Documentation**: https://github.com/yourusername/chainpe
- **Issues**: https://github.com/yourusername/chainpe/issues
- **Discord**: Join our community (link)

---

**Happy Building! 🚀**

ChainPe makes it easy for AI agents to autonomously discover and pay for services using real blockchain micropayments.
