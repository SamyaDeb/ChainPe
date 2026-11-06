"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { AnimatedSphere } from "./animated-sphere";
import { CONTAINER } from "./section-layout";

const words = ["pay", "discover", "rate", "settle"];

const stats = [
  { value: "1", label: "command to start selling" },
  { value: "0", label: "changes to your API" },
  { value: "2", label: "ways for agents to pay" },
  { value: "$0.001", label: "smallest price paid on testnet" },
];

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative min-h-svh flex flex-col overflow-hidden">
      {/* Animated sphere background */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/4 w-[600px] h-[600px] lg:w-[800px] lg:h-[800px] opacity-15 lg:opacity-40 pointer-events-none">
        <AnimatedSphere />
      </div>

      <div className={`relative z-10 w-full flex-1 flex flex-col justify-center pt-28 pb-12 lg:pb-16 ${CONTAINER}`}>
        <span
          className={`flex items-center gap-3 text-sm font-mono text-muted-foreground mb-8 transition-opacity duration-700 ${
            isVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="w-8 h-px bg-foreground/30" />
          x402 payments for AI agents, on Arc
        </span>

        <h1
          className={`text-[clamp(3.25rem,10vw,9rem)] font-display leading-[0.95] tracking-tight mb-10 lg:mb-14 transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <span className="block">The layer to</span>
          <span className="block" aria-live="off">
            <span className="relative inline-block">
              <span key={wordIndex} className="inline-flex">
                {words[wordIndex].split("").map((char, i) => (
                  <span
                    key={`${wordIndex}-${i}`}
                    className="inline-block animate-char-in"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    {char}
                  </span>
                ))}
              </span>
              <span className="absolute -bottom-2 left-0 right-0 h-3 bg-foreground/10" />
            </span>
          </span>
        </h1>

        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
          <p className="text-xl lg:text-2xl text-muted-foreground leading-relaxed max-w-xl">
            Turn any API into a paid service for AI agents. One command. USDC on Arc. Settled by Circle.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 shrink-0">
            <Button
              size="lg"
              className="bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base rounded-full group"
              onClick={() => (window.location.href = "/docs/getting-started/sell-your-api")}
            >
              Start integrating
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-8 text-base rounded-full border-foreground/20 hover:bg-foreground/5"
              onClick={() => (window.location.href = "/docs")}
            >
              Read the docs
            </Button>
          </div>
        </div>
      </div>

      {/* Stats sit in the page flow, so they can never cover the buttons */}
      <div className="relative z-10 border-t border-foreground/10 bg-background/70 backdrop-blur-sm">
        <div className={`w-full grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6 py-8 ${CONTAINER}`}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-3xl lg:text-4xl font-display">{stat.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
