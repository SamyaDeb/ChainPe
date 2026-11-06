# ChainPe voiceover: read this in your own voice

The recorded cut runs 3:47. ETHGlobal rejects anything over 4:00, and bans AI voices.
Start each paragraph at its time. Each block is the time you have before the next shot.

**0:00** (21s to speak)

Let me ask you a question. What happens when an AI agent needs to pay for something? Right now, nothing. Agents can read, write code and browse the internet, but they can't pay. So someone hard-codes an API key or a credit card, and that just doesn't scale.

**0:21** (14s to speak)

That's ChainPe. It turns any API, MCP server or AI agent into a service other agents can pay for, per call, in USDC on Arc. Circle settles the payment, and ERC-8004 tells you who to trust.

**0:35** (20s to speak)

So here's a normal API. No blockchain code, no payment code. I run chainpe init, point it at my backend, and set my price. Then one command to go live. Now every unpaid request gets a 402, with two ways to pay: a direct USDC payment, or a Circle Gateway nanopayment. I never touched the API code.

**0:55** (13s to speak)

Now I register it. That gives my service an on-chain account and an ERC-8004 identity on Arc. And doctor checks it's ready for agents and for Circle's marketplace. Ten out of ten.

**1:08** (10s to speak)

If you're building the agent, it's just a few lines. One object, with a spending limit. Discover, ranked by reputation. And pay, which handles the 402.

**1:19** (38s to speak)

I'm not going to talk about this anymore. Let me show you, live. This is Claude Desktop, with the ChainPe wallet configured: Arc testnet, spending limits, and the key stays masked. I ask Claude to compare the swap agents and pay the best-rated one for a live quote. It finds three agents, with ratings from the chain. Drift is the cheapest, but it's a bad actor I built: it keeps five percent, and its score shows it. So Claude picks Bolt, asks for my OK, and pays over x402. And here's the transaction on Arc.

**1:57** (27s to speak)

Now the same thing with no chat, and a real swap. This script is an agent hiring another agent. It discovers them, pays for live quotes, and hires the best value. The agent swaps through Circle App Kit, the script measures what really arrived on-chain, and posts that score to ERC-8004. I seeded the first ratings from a test wallet, and every one came from a real paid swap.

**2:24** (22s to speak)

And every developer gets their own dashboard. Sign in with your wallet, and you see your revenue, checked against Arc and Circle's records. Every payment, every buyer, your reputation and your listing health. A different wallet sees only its own services.

**2:46** (28s to speak)

This is where we built it: Arc Studio. Here's the ChainPeAccounts contract, its Foundry tests with invariants, and the deployment on Arc testnet, with live state from the chain. The dashboard was built here too. Settlement runs on Circle's Facilitator, nanopayments on Gateway, discovery on the Discovery API, and swaps on App Kit. We didn't rebuild any of them.

**3:14** (17s to speak)

So how do we make money? The CLI and SDK are free, and buyers pay developers directly, so we never hold funds. We earn from the Pro dashboard, paid in USDC on Arc. And next, an opt-in usage fee of one percent of verified revenue.

**3:31** (16s to speak)

ChainPe ran on Avalanche in June. This weekend, we brought it to Arc. Software is about to start buying from software, billions of times a day. When it does, it needs a way to pay, and a way to know who to trust. That's ChainPe. Thank you.

