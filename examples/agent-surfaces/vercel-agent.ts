/**
 * ChainPe × Vercel AI SDK — an agent that discovers and pays for services.
 *
 * Run:
 *   cp .env.example .env   # fill in CHAINPE_PRIVATE_KEY + ANTHROPIC_API_KEY
 *   npm install
 *   npm run vercel -- "Find a weather service and tell me the weather in London"
 *
 * The wallet pays in USDC on Avalanche Fuji; the provider's facilitator pays gas.
 */
import 'dotenv/config'
import { generateText, stepCountIs } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createChainPeTools } from '@chainpe/ai-tools/vercel'

const privateKey = process.env.CHAINPE_PRIVATE_KEY
if (!privateKey) throw new Error('Set CHAINPE_PRIVATE_KEY in .env')
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY in .env')

const prompt =
  process.argv.slice(2).join(' ') ||
  'Discover the services available on ChainPe, pick the most reputable relevant one, ' +
    'call it, and summarize what it returned.'

const tools = createChainPeTools({
  privateKey,
  network: 'fuji',
  autoFeedback: true // build the provider's on-chain reputation after paying
})

const { text, steps } = await generateText({
  model: anthropic('claude-opus-4-8'),
  tools,
  stopWhen: stepCountIs(10),
  prompt
})

for (const step of steps) {
  for (const call of step.toolCalls ?? []) {
    console.log(`\n🔧 ${call.toolName}(${JSON.stringify(call.input)})`)
  }
}

console.log('\n🤖', text)
