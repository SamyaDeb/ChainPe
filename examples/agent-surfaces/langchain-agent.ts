/**
 * ChainPe × LangChain — the *same* discover + paid-fetch tools, on a LangChain
 * ReAct agent. Proves ChainPe is framework-agnostic infrastructure, not a
 * single-client integration.
 *
 * Run:
 *   cp .env.example .env   # fill in CHAINPE_PRIVATE_KEY + ANTHROPIC_API_KEY
 *   npm install
 *   npm run langchain -- "Find a weather service and tell me the weather in London"
 */
import 'dotenv/config'
import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage } from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createChainPeLangChainTools } from '@chainpe/ai-tools/langchain'

const privateKey = process.env.CHAINPE_PRIVATE_KEY
if (!privateKey) throw new Error('Set CHAINPE_PRIVATE_KEY in .env')
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY in .env')

const prompt =
  process.argv.slice(2).join(' ') ||
  'Discover the services available on ChainPe, pick the most reputable relevant one, ' +
    'call it, and summarize what it returned.'

const { chainpeFetchTool, discoverServiceTool } = createChainPeLangChainTools({
  privateKey,
  network: 'fuji',
  autoFeedback: true
})

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-opus-4-8', temperature: 0 }),
  tools: [discoverServiceTool, chainpeFetchTool]
})

const result = await agent.invoke({ messages: [new HumanMessage(prompt)] })

const last = result.messages[result.messages.length - 1]
console.log('\n🤖', typeof last.content === 'string' ? last.content : JSON.stringify(last.content))
