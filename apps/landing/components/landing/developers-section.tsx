"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { CodeStack, CONTAINER, SECTION, SectionHeader, SPLIT } from "./section-layout";

const codeExamples = [
  {
    label: "Install",
    code: `git clone https://github.com/SamyaDeb/ChainPe
cd ChainPe && git checkout arc
npm install && npm run build:cli`,
  },
  {
    label: "Sell",
    code: `chainpe init
chainpe start --network arc-testnet
chainpe identity
chainpe register
chainpe doctor`,
  },
  {
    label: "Buy",
    code: `# pay a live API on Arc testnet
chainpe fetch \\
  "https://chainpe-arc-demo-production.up.railway.app/forecast?city=London" \\
  --rail exact --max 0.02`,
  },
];

const features = [
  { title: "Typed SDK", description: "@chainpearc/sdk is written in TypeScript and ships its types." },
  { title: "Paid fetch", description: "chainpe fetch pays any 402 in USDC, never above your --max." },
  { title: "Two payment options", description: "Normal x402 payments and Circle Gateway nanopayments." },
  { title: "Open source", description: "MIT licensed. The Arc version lives on the arc branch." },
];

export function DevelopersSection() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeExamples[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="developers" className={SECTION}>
      <div className={CONTAINER}>
        <div className={SPLIT}>
          <div className="min-w-0">
            <SectionHeader
              eyebrow="For developers"
              title="Built for devs."
              muted="By a dev."
              description="A small CLI that gets out of your way. One command to start selling. Works with any HTTP API, in any language."
              className="mb-10 lg:mb-12"
            />

            <div className="grid sm:grid-cols-2 gap-6">
              {features.map((feature) => (
                <div key={feature.title}>
                  <h3 className="font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 flex flex-col">
            <div className="flex-1 min-w-0 border border-foreground/10 flex flex-col">
              <div className="flex items-center border-b border-foreground/10">
                {codeExamples.map((example, idx) => (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    aria-pressed={activeTab === idx}
                    className={`px-5 lg:px-6 py-4 text-sm font-mono transition-colors relative ${
                      activeTab === idx ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {example.label}
                    {activeTab === idx && <span className="absolute bottom-0 left-0 right-0 h-px bg-foreground" />}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-4 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy code"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex-1 min-w-0 p-6 lg:p-8">
                <CodeStack
                  items={codeExamples.map((example) => example.code)}
                  active={activeTab}
                  lineClassName="text-foreground/80"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <a href="/docs" className="text-foreground underline-offset-4 hover:underline">
                Read the docs
              </a>
              <a href="/docs/getting-started/quickstart" className="text-muted-foreground hover:text-foreground">
                Pay an API in 5 minutes
              </a>
              <a href="https://github.com/SamyaDeb/ChainPe" className="text-muted-foreground hover:text-foreground">
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
