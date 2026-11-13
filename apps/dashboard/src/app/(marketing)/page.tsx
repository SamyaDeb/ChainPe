import type { Metadata } from 'next'
import InstallBox from '@/components/marketing/InstallBox'
import WaitlistForm from '@/components/marketing/WaitlistForm'

export const metadata: Metadata = {
  title: 'ChainPe | AI Agent Marketplace on Avalanche',
  description:
    'ChainPe lets AI agents pay for APIs autonomously using Avalanche micropayments — no human approval, no subscriptions, just pay-per-request with native AVAX.',
}

const features = [
  { title: 'x402 Protocol', desc: 'Real HTTP 402 "Payment Required" implementation — how the web was designed to handle payments' },
  { title: 'native AVAX', desc: 'Pure native payments, no wrapped tokens or bridges. Near-zero fees make micropayments viable' },
  { title: 'sub-second finality', desc: 'Avalanche confirms in about 1 second. Agents can\'t wait 10 minutes for Bitcoin confirmations' },
  { title: 'AI SDK Integration', desc: 'Built on Vercel AI SDK, works with any LLM. npm install and you\'re paying for APIs' },
  { title: 'Direct Settlement', desc: 'Providers get paid directly to their Avalanche wallet. No intermediary holds funds' },
  { title: 'Safe by Design', desc: 'Agent wallets have balance limits. Set maxPricePerRequest caps. Payments fail gracefully when empty' },
]

const useCases = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    ),
    title: 'AI Research Agents',
    desc: 'Agent needs 1000 academic paper summaries — pays per paper, not a $500/month subscription',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    ),
    title: 'Trading Bots',
    desc: 'Bot needs real-time price feeds from 5 providers — pays each per request, picks the best',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
    title: 'Customer Service AI',
    desc: 'Agent needs to verify user identity — pays KYC service only when needed',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    ),
    title: 'Content Generation',
    desc: 'Agent needs stock photos — pays per image, not monthly Getty subscription',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
        <rect x="9" y="9" width="6" height="6"/>
        <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
        <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
        <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
        <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
      </svg>
    ),
    title: 'IoT / Smart Devices',
    desc: 'Autonomous car needs traffic data — pays per mile of coverage',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    title: 'Any API, Any Agent',
    desc: 'Turn any API into a paid service. Turn any AI agent into a paying customer. Powered by AVAX.',
  },
]

const faqs = [
  {
    q: 'What is ChainPe?',
    a: 'ChainPe is an AI Agent Marketplace on Avalanche that uses the x402 payment protocol. It enables AI agents to autonomously discover services, pay for them with native AVAX micropayments, and receive results — all without human intervention.',
  },
  {
    q: 'Why not just use Stripe?',
    a: 'Stripe requires merchant accounts, human verification, and charges 2.9% + $0.30 per transaction. A $0.05 micropayment would cost more in fees than the payment itself. Avalanche transactions cost a fraction of a cent in AVAX, making true micropayments economically viable.',
  },
  {
    q: 'Why Avalanche specifically?',
    a: 'Speed and cost. Agents need instant settlement — Avalanche confirms in about 1 second. The fees are low enough that even $0.01 payments make economic sense. No other chain provides this combination for micropayments.',
  },
  {
    q: 'How do providers get paid?',
    a: "Directly to their Avalanche wallet. No intermediary holds funds. The x402 proxy verifies the payment hit the chain before forwarding the API request to the provider.",
  },
  {
    q: 'What prevents agents from overspending?',
    a: 'Agent wallets have a balance limit. When it\'s empty, payments fail gracefully. Developers can also set maxPricePerRequest caps in the config to control spending per request.',
  },
  {
    q: 'What is the x402 protocol?',
    a: 'x402 is based on HTTP 402 "Payment Required" — a status code that\'s been in the HTTP spec since the beginning but was never widely used. It\'s how the web was designed to handle payments. ChainPe finally puts it to use with blockchain-backed micropayments.',
  },
  {
    q: 'How do I get started?',
    a: 'Install the SDK with npm install @chainpe/agent and you\'re ready to go. The SDK integrates with the Vercel AI SDK and works with any LLM provider. Check our docs for a 5-minute quickstart guide.',
  },
]

export default function LandingPage() {
  return (
    <>
      {/* ===== HERO ===== */}
      <section className="hero" id="hero">
        <div className="container">
          <div className="hero-badge">
            <span className="badge-new">New</span>
            <span className="badge-text">Built on Avalanche with the x402 payment protocol.</span>
          </div>
          <h1 className="hero-title">
            The payment rail for<br />the <span className="highlight">AI economy</span>
          </h1>
          <p className="hero-subtitle">
            AI agents discover services, pay in native AVAX, and get results &mdash; all in one
            autonomous flow. No human in the loop. No subscriptions. Pay only for what you use.
          </p>
          <InstallBox />
        </div>
      </section>

      {/* ===== VIDEO DEMO ===== */}
      <section className="section section-demo" id="demo">
        <div className="container">
          <div className="video-wrapper">
            <video autoPlay loop muted playsInline>
              <source src="/IMG_8555.MOV" type="video/quicktime" />
              <source src="/IMG_8555.MOV" type="video/mp4" />
            </video>
          </div>
        </div>
      </section>

      {/* ===== THE PROBLEM ===== */}
      <section className="section" id="problem">
        <div className="container">
          <h2 className="section-title">The Problem</h2>
          <p className="section-description">
            AI agents are getting smarter, but they can&apos;t pay for anything. When an agent needs
            weather data, stock prices, or any paid API &mdash; it&apos;s stuck. Current payment
            systems require human approval, credit cards, or monthly subscriptions. That doesn&apos;t
            work for autonomous agents making thousands of micro-requests.
          </p>
        </div>
      </section>

      {/* ===== SOLUTION ===== */}
      <section className="section" id="solution">
        <div className="container">
          <h2 className="section-title">What is ChainPe?</h2>
          <p className="section-description">
            ChainPe is an AI Agent Marketplace on Avalanche using the x402 payment protocol. Agents
            discover services, pay in native AVAX, and get results &mdash; all in one autonomous flow.
          </p>
          <div className="features-list">
            {features.map(f => (
              <div className="feature-item" key={f.title}>
                <span className="feature-star">[&#9733;]</span>
                <div>
                  <strong>{f.title}</strong>
                  <span className="feature-desc">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <a href="/docs" className="inline-link">Read docs &rarr;</a>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className="section section-stats" id="stats">
        <div className="container">
          <h2 className="section-title">Why Avalanche + x402</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-visual stat-visual-1" />
              <div className="stat-info">
                <span className="stat-number">4s</span>
                <span className="stat-label">Block Finality</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-visual stat-visual-2" />
              <div className="stat-info">
                <span className="stat-number">~0.001</span>
                <span className="stat-label">AVAX per Tx Fee</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-visual stat-visual-3" />
              <div className="stat-info">
                <span className="stat-number">$0.05</span>
                <span className="stat-label">Per API Request</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== VS STRIPE ===== */}
      <section className="section" id="vs-stripe">
        <div className="container">
          <h2 className="section-title">Why not just use Stripe?</h2>
          <p className="section-description">
            Stripe requires merchant accounts, human verification, and charges 2.9% + $0.30 per
            transaction. A $0.05 micropayment would cost more in fees than the payment itself.
            Avalanche transactions cost a fraction of a cent in AVAX.
          </p>
        </div>
      </section>

      {/* ===== USE CASES ===== */}
      <section className="section" id="use-cases">
        <div className="container">
          <h2 className="section-title">Real-World Applications</h2>
          <p className="section-description">
            Any API can become a paid service. Any AI agent can become a paying customer. ChainPe is
            the marketplace connecting them.
          </p>
          <div className="use-cases-grid">
            {useCases.map(uc => (
              <div className="use-case-card" key={uc.title}>
                <div className="use-case-icon">{uc.icon}</div>
                <h3>{uc.title}</h3>
                <p>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section" id="faq">
        <div className="container">
          <h2 className="section-title">FAQ</h2>
          <div className="faq-list">
            {faqs.map(faq => (
              <details className="faq-item" key={faq.q}>
                <summary className="faq-question">{faq.q}</summary>
                <p className="faq-answer">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA / WAITLIST ===== */}
      <section className="section section-cta" id="get-started">
        <div className="container">
          <h2 className="section-title">Be the first to know when we launch</h2>
          <p className="section-description">
            We&apos;ve built the SDK, the proxy, and the agent. The x402 flow works with real AVAX.
            We&apos;re ready to onboard API providers and agent developers.
          </p>
          <WaitlistForm />
        </div>
      </section>
    </>
  )
}
