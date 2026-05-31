/**
 * ChainPe Agent
 * Pre-built AI agent with x402 payment capabilities
 * 
 * SECURITY: Wallet mnemonics are retrieved from OS keychain at runtime,
 * never stored in plaintext files.
 */

import { generateText, stepCountIs, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ai-sdk-ollama";
import { z } from "zod";

import type {
  AgentConfig,
  RunOptions,
  TaskResult,
  StepInfo,
  PaymentReceipt,
  PaymentSummary,
  LLMProvider,
} from "./types.js";
import { loadConfig, getWalletMnemonic } from "./config.js";
import { RegistryClient } from "./registry.js";
import { PaymentClient } from "./payment.js";
import {
  createDiscoverServiceTool,
  createCallPaidApiTool,
  createCallFreeApiTool,
  resetPaidCallCache,
} from "./tools/index.js";

// ============================================================================
// Agent Class
// ============================================================================

export interface ChainPeAgentOptions {
  config?: AgentConfig;
  verbose?: boolean;
}

/**
 * ChainPe Agent - Pre-built AI agent that can discover and call paid services
 */
export class ChainPeAgent {
  private config: AgentConfig | null = null;
  private registryClient: RegistryClient | null = null;
  private paymentClient: PaymentClient | null = null;
  private verbose: boolean;
  private initialized: boolean = false;

  constructor(options: ChainPeAgentOptions = {}) {
    this.config = options.config || null;
    this.verbose = options.verbose || false;
  }

  /**
   * Initializes the agent (loads config if not provided)
   * Retrieves wallet mnemonic securely from OS keychain
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Load config if not provided
    if (!this.config) {
      const loaded = await loadConfig();
      if (!loaded) {
        throw new Error(
          "No agent configuration found. Run 'chainpe-agent init' first."
        );
      }
      this.config = loaded;
    }

    // Initialize registry client
    this.registryClient = new RegistryClient(
      (this.config.network || "testnet") as "testnet" | "mainnet"
    );

    // Get mnemonic from OS keychain (secure storage)
    const mnemonic = await getWalletMnemonic(this.config.wallet.address);
    if (!mnemonic) {
      throw new Error(
        `Wallet mnemonic not found in OS keychain for address: ${this.config.wallet.address}\n` +
        `Run 'chainpe-agent init' to set up your wallet, or 'chainpe-agent migrate-keychain' ` +
        `to migrate from legacy plaintext storage.`
      );
    }

    // Initialize payment client with mnemonic from keychain
    this.paymentClient = new PaymentClient({
      mnemonic,
      network: this.config.network || "testnet",
    });

    this.initialized = true;
  }

  /**
   * Creates the LLM model instance
   */
  private createModel(): any {
    if (!this.config) {
      throw new Error("Agent not initialized");
    }

    const { mode, provider, model, apiKey, baseURL } = this.config.llm;
    let resolvedModel = model;

    // Handle Gemini model name resolution
    if (provider === "gemini") {
      if (model === "gemini-1.5-pro") {
        resolvedModel = "gemini-1.5-pro-latest";
      } else if (model === "gemini-1.5-flash") {
        resolvedModel = "gemini-1.5-flash-latest";
      } else if (model === "gemini-2.0-flash-exp") {
        resolvedModel = "gemini-2.0-flash";
      }
    }

    // Local mode - use Ollama provider with native tool calling support
    if (mode === "local") {
      // Extract host from baseURL (e.g., "http://localhost:11434/v1" -> "http://localhost:11434")
      let ollamaHost = "http://localhost:11434";
      if (baseURL) {
        // Remove /v1 suffix if present since Ollama provider uses native API
        ollamaHost = baseURL.replace(/\/v1\/?$/, "");
      }
      
      const ollama = createOllama({ 
        baseURL: ollamaHost,
      });
      return ollama(resolvedModel);
    }

    // API mode - use cloud providers
    if (!apiKey) {
      throw new Error("API mode requires apiKey to be configured");
    }

    if (provider === "openai") {
      // Support custom baseURL for OpenAI-compatible APIs (Together, etc.)
      const openai = createOpenAI({ apiKey, baseURL });
      return openai.chat(resolvedModel);
    } else if (provider === "groq") {
      // Use OpenAI provider with Groq's compatible endpoint
      const groq = createOpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
        name: "groq",
      });
      return groq.chat(resolvedModel);
    } else if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(resolvedModel);
    } else if (provider === "gemini") {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(resolvedModel);
    }

    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  /**
   * Creates the tools for the agent
   */
  private createTools(options: { includeDiscover?: boolean; includeFree?: boolean; providerHint?: string } = {}): any {
    if (!this.registryClient || !this.paymentClient) {
      throw new Error("Agent not initialized");
    }

    const { includeDiscover = true, includeFree = true, providerHint } = options;

    const tools: any = {
      callPaidApi: createCallPaidApiTool({
        paymentClient: this.paymentClient,
        registryClient: this.registryClient,
        providerHint,
      }),
    };

    if (includeDiscover) {
      tools.discoverService = createDiscoverServiceTool({
        registryClient: this.registryClient,
      });
    }

    if (includeFree) {
      tools.callFreeApi = createCallFreeApiTool();
    }

    return tools;
  }

  private createFallbackTools(): any {
    return {
      callPaidApi: tool({
        description:
          "Call a paid marketplace service by name. Use serviceName and optional path/method/body.",
        inputSchema: z.object({
          serviceName: z.string(),
          path: z.string().optional().default("/"),
          method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().default("GET"),
          body: z.record(z.unknown()).optional(),
        }),
        execute: async ({ serviceName, path, method, body }) => {
          if (!this.paymentClient || !this.registryClient) {
            return { success: false, error: "Payment client not initialized" };
          }

          try {
            // Try to find service info from config
            const fs = await import("fs/promises");
            const os = await import("os");
            const pathMod = await import("path");
            
            let service = null;
            try {
              const configPath = pathMod.join(os.homedir(), ".chainpe", "config.json");
              const configContent = await fs.readFile(configPath, "utf-8");
              const config = JSON.parse(configContent);
              
              if (config.serviceName === serviceName || config.serviceName.toLowerCase() === serviceName.toLowerCase()) {
                service = {
                  id: `onchain:${config.walletAddress}:${config.serviceName}`,
                  name: config.serviceName,
                  description: config.serviceDescription || "Provider service",
                  tags: config.tags || [],
                  endpoint: `http://localhost:${config.proxyPort || 4402}`,
                  pricePerRequest: config.pricePerRequest || "0.05",
                  paymentToken: config.paymentToken as "ALGO" | "USDC",
                  walletAddress: config.walletAddress,
                  network: config.network as "testnet" | "mainnet",
                };
              }
            } catch {
              // Config not found, use defaults
            }

            // Fallback to default if config not found
            if (!service) {
              service = {
                id: `local:${serviceName}`,
                name: serviceName,
                description: "Local fallback service",
                tags: ["local", "fallback"],
                endpoint: "http://localhost:4402",
                pricePerRequest: "0.05",
                paymentToken: "ALGO" as const,
                walletAddress: "",
                network: "testnet" as const,
              };
            }

            const localPath = path?.startsWith("/") ? path : `/${path ?? ""}`;
            const response = await this.paymentClient.callService(service, localPath || "/", {
              method: method as "GET" | "POST" | "PUT" | "DELETE",
              body,
            });

            return {
              success: true,
              status: response.status,
              data: response.data,
              paid: response.paid,
              payment: response.paymentReceipt
                ? {
                    amount: response.paymentReceipt.amount,
                    token: response.paymentReceipt.token,
                    recipient: response.paymentReceipt.recipient,
                  }
                : undefined,
            };
          } catch (error) {
            return {
              success: false,
              error: `API call failed: ${(error as Error).message}`,
            };
          }
        },
      }),
    };
  }

  /**
   * Runs a task with the agent
   */
  async run(task: string, options: RunOptions = {}): Promise<TaskResult> {
    const startTime = Date.now();
    await this.ensureInitialized();

    // Reset paid call cache at start of each run to prevent stale cache
    resetPaidCallCache();

    const { provider, maxSteps = 10, onStep, onPayment } = options;
    const effectiveMaxSteps = provider ? Math.min(maxSteps, 3) : maxSteps;

    // Set up payment callback
    if (onPayment && this.paymentClient) {
      // Reset tracking for this task
      this.paymentClient.reset();
    }

    const steps: StepInfo[] = [];
    let stepNumber = 0;

    try {
      const includeDiscover = !provider;
      // IMPORTANT: Disable free API when discovery is enabled to force marketplace usage
      const includeFree = false;

      // Build system prompt
      let systemPrompt = `You are an AI assistant that MUST use the ChainPe paid marketplace for all data services.

MANDATORY WORKFLOW - YOU MUST FOLLOW THESE STEPS IN ORDER:
1. FIRST: Call 'discoverService' with a simple query (e.g., "bitcoin" or "weather" - use single keywords).
2. SECOND: Review the services returned. Select the BEST match based on name and description.
3. THIRD: Call 'callPaidApi' with:
   - serviceName: the EXACT name from discovery (e.g., "BTC" not "bitcoin-service")
   - path: the correct API path with query parameters
   - method: "GET" for data retrieval

CRITICAL API PATHS - USE THESE EXACT PATHS:
- Bitcoin/crypto prices: path="/crypto?symbol=BTC" (or ETH, SOL, ALGO, AVAX)
- Stock prices: path="/stock?symbol=AAPL" (or any stock ticker)
- Market summary: path="/market/summary"
- Weather data: path="/weather?city=London" (or any city name)

IMPORTANT:
- All payments happen automatically via x402 on Algorand - no user approval needed.
- Service names are SHORT like "BTC", "Weather", "Sam" - use exactly what discoverService returns.
- ALWAYS include the full path with query parameters (e.g., "/crypto?symbol=BTC" NOT just "/")
- Do NOT skip the discovery step. You must discover first to find available services.
- CRITICAL: Call 'callPaidApi' ONLY ONCE per user request. Each call costs real money. After receiving the API response, immediately provide the answer to the user - do NOT call the API again.`;

      if (includeDiscover) {
        systemPrompt += `\n\nYour first action MUST be to call 'discoverService' with a simple keyword like "bitcoin" or "crypto".`;
      }

      // If a specific provider is requested, add it to the prompt
      if (provider) {
        systemPrompt = `You are a helpful AI assistant with access to paid AI services on the ChainPe marketplace.

CRITICAL INSTRUCTION: The user has specified to use ONLY the service with the EXACT name "${provider}".
You MUST call 'callPaidApi' with serviceName="${provider}" (use this exact string, do not modify or rename it).
Determine the appropriate API path and method based on the task.
Make exactly one paid call unless the user explicitly asks for multiple calls.
DO NOT use 'discoverService' or 'callFreeApi' when a provider is specified.
Provide a clear answer based on the API response.`;
      }

      // Create the model and tools
      const model = this.createModel();
      const tools = this.createTools({
        includeDiscover,
        includeFree,
        providerHint: provider,
      });

      // Run the agentic loop
      let result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(effectiveMaxSteps),
        system: systemPrompt,
        prompt: task,
        onStepFinish: (event) => {
          stepNumber++;

          const stepInfo: StepInfo = {
            stepNumber,
            text: event.text,
          };

          // Extract tool call info if present
          if (event.toolCalls && event.toolCalls.length > 0) {
            const toolCall = event.toolCalls[0];
            stepInfo.toolName = toolCall.toolName;
            stepInfo.toolArgs = toolCall.input as Record<string, unknown>;
          }

          // Extract tool result if present
          if (event.toolResults && event.toolResults.length > 0) {
            const toolResult = event.toolResults[0] as { output?: unknown };
            stepInfo.toolResult = toolResult.output;
          }

          steps.push(stepInfo);

          if (onStep) {
            onStep(stepInfo);
          }

          if (this.verbose) {
            console.log(`Step ${stepNumber}:`, stepInfo.toolName || "text");
          }
        },
      });

      if (provider && steps.length === 1 && !steps[0]?.toolName) {
        const fallbackPrompt = `Use callPaidApi with serviceName \"${provider}\". Analyze the task and choose the appropriate path and method.`;
        result = await generateText({
          model,
          tools: this.createFallbackTools(),
          stopWhen: stepCountIs(2),
          system: "You must call callPaidApi exactly once and then return the result.",
          prompt: fallbackPrompt,
          onStepFinish: (event) => {
            stepNumber++;
            const stepInfo: StepInfo = {
              stepNumber,
              text: event.text,
            };

            if (event.toolCalls && event.toolCalls.length > 0) {
              const toolCall = event.toolCalls[0];
              stepInfo.toolName = toolCall.toolName;
              stepInfo.toolArgs = toolCall.input as Record<string, unknown>;
            }

            if (event.toolResults && event.toolResults.length > 0) {
              const toolResult = event.toolResults[0] as { output?: unknown };
              stepInfo.toolResult = toolResult.output;
            }

            steps.push(stepInfo);
            if (onStep) onStep(stepInfo);
          },
        });
      }

      // Build payment summary
      const payments: PaymentSummary = {
        totalSpent: this.paymentClient?.getTotalSpent() || { ALGO: "0", USDC: "0" },
        transactionCount: this.paymentClient?.getTransactionCount() || 0,
        receipts: this.paymentClient?.getReceipts() || [],
      };

      // Trigger payment callbacks
      if (onPayment && payments.receipts.length > 0) {
        for (const receipt of payments.receipts) {
          onPayment(receipt);
        }
      }

      return {
        text: result.text,
        success: true,
        steps,
        payments,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        text: "",
        success: false,
        steps,
        payments: {
          totalSpent: { ALGO: "0", USDC: "0" },
          transactionCount: 0,
          receipts: [],
        },
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Gets the wallet address
   */
  async getWalletAddress(): Promise<string> {
    await this.ensureInitialized();
    return this.paymentClient!.getAddress();
  }

  /**
   * Lists available services
   */
  async listServices(): Promise<
    Array<{ name: string; description: string; price: string }>
  > {
    await this.ensureInitialized();
    // On-chain registry requires developer address + service name to query.
    // Return an informational placeholder — consumers discover services via
    // findByName(name, developerAddress) or getService(developer, name).
    return [];
  }

  /**
   * Gets the current configuration
   */
  getConfig(): AgentConfig | null {
    return this.config;
  }

  /**
   * Creates a ChainPe agent from saved configuration
   * Convenience factory method for SDK users
   */
  static async fromConfig(): Promise<ChainPeAgent> {
    const config = await loadConfig();
    if (!config) {
      throw new Error(
        "No agent configuration found. Run 'chainpe-agent init' first."
      );
    }
    const agent = new ChainPeAgent({ config });
    await agent.ensureInitialized();
    return agent;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a new ChainPe agent instance
 */
export function createAgent(options?: ChainPeAgentOptions): ChainPeAgent {
  return new ChainPeAgent(options);
}
