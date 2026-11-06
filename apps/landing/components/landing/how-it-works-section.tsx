"use client";

import { useEffect, useState } from "react";
import { CodeStack, CONTAINER, SECTION, SectionHeader, SPLIT } from "./section-layout";

const steps = [
  {
    number: "1",
    title: "Wrap your API",
    description: "Put the ChainPe proxy in front of any HTTP API. It answers unpaid requests with 402 Payment Required and a USDC price.",
    code: `chainpe init
chainpe start --network arc-testnet

# unpaid request -> 402 Payment Required`,
  },
  {
    number: "2",
    title: "Agent pays, API answers",
    description: "The agent signs a USDC payment. Circle settles it on Arc, and only then does the proxy call your API.",
    code: `chainpe fetch \\
  "https://chainpe-arc-demo-production.up.railway.app/forecast?city=Tokyo" \\
  --rail exact --max 0.02

# 200 OK + Arc explorer link`,
  },
  {
    number: "3",
    title: "Get found, get rated",
    description: "Give your service an ERC-8004 identity, register it, and check it is ready for Circle's Agent Marketplace.",
    code: `chainpe identity   # ERC-8004 on Arc
chainpe register   # provider account
chainpe doctor     # ready for Circle`,
  },
];

export function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    if (!autoPlay) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoPlay]);

  return (
    <section id="how-it-works" className={`${SECTION} bg-foreground text-background`}>
      <div className={CONTAINER}>
        <SectionHeader eyebrow="Process" title="Three steps." muted="From API to paid service." inverted />

        {/* Both columns stretch to one height */}
        <div className={SPLIT}>
          <div className="min-w-0 border-t border-background/10">
            {steps.map((step, index) => (
              <button
                key={step.number}
                type="button"
                onClick={() => {
                  setActiveStep(index);
                  setAutoPlay(false);
                }}
                aria-current={activeStep === index}
                className={`w-full text-left py-6 lg:py-8 border-b border-background/10 transition-opacity duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-background ${
                  activeStep === index ? "opacity-100" : "opacity-60 hover:opacity-90"
                }`}
              >
                <div className="flex items-start gap-6">
                  <span className="w-6 shrink-0 font-display text-2xl lg:text-3xl text-background/50">{step.number}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-2xl lg:text-3xl font-display mb-3">{step.title}</h3>
                    <p className="text-background/70 leading-relaxed">{step.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="min-w-0 border border-background/10 flex flex-col">
            <div className="px-6 py-4 border-b border-background/10 flex items-center justify-between">
              <span className="text-xs font-mono text-background/60">terminal</span>
              <span className="text-xs font-mono text-background/60">Step {steps[activeStep].number} of 3</span>
            </div>

            <div className="flex-1 min-w-0 p-6 lg:p-8 flex items-center">
              <CodeStack items={steps.map((step) => step.code)} active={activeStep} lineClassName="text-background/80" />
            </div>

            <div className="px-6 py-4 border-t border-background/10 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs font-mono text-background/60">Arc testnet</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
