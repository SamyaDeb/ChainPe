/**
 * ChainPe Agent Example
 *
 * This example demonstrates how to use the ChainPe agent in your code.
 *
 * Prerequisites:
 * 1. Run `chainpe-agent init` to configure your agent
 * 2. Ensure you have testnet ALGO in your wallet
 * 3. Make sure there are services registered in the registry
 *
 * Run with: npx tsx examples/example.ts
 */

import { ChainPeAgent } from "../src/index.js";

async function main() {
  console.log("🤖 ChainPe Agent Example\n");

  // Create the agent (reads config from ~/.chainpe/agent.json)
  const agent = new ChainPeAgent();

  // Example 1: List available services
  console.log("📋 Listing available services...\n");
  const services = await agent.listServices();

  if (services.length === 0) {
    console.log("No services available. Register some services first!");
    return;
  }

  for (const service of services) {
    console.log(`  • ${service.name}`);
    console.log(`    ${service.description}`);
    console.log(`    Price: ${service.price}\n`);
  }

  // Example 2: Run a simple task
  console.log("🚀 Running a task...\n");

  const result = await agent.run(
    "Find an AI service that can help with research and call it to summarize the topic of machine learning",
    {
      maxSteps: 5,
      verbose: true,
      onStep: (step) => {
        if (step.toolName) {
          console.log(`  → Tool: ${step.toolName}`);
        }
      },
      onPayment: (receipt) => {
        console.log(
          `  💰 Paid ${receipt.amount} ${receipt.token} to ${receipt.service}`
        );
      },
    }
  );

  console.log("\n📝 Result:\n");
  console.log(result.text);

  console.log("\n📊 Summary:");
  console.log(`  Success: ${result.success}`);
  console.log(`  Steps: ${result.steps.length}`);
  console.log(`  Duration: ${result.duration}ms`);
  console.log(`  Payments: ${result.payments.transactionCount}`);
  console.log(`  Total ALGO: ${result.payments.totalSpent.ALGO}`);
  console.log(`  Total USDC: ${result.payments.totalSpent.USDC}`);
}

main().catch(console.error);
