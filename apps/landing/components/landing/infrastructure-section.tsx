"use client";

import { SETTLEMENT_GAS_USD } from "@/lib/proof";

import { useEffect, useState, useRef } from "react";

// What actually runs where. No live latency numbers until there is a status API to back them.
const locations = [
  { city: "Avalanche C-Chain", region: "Settlement and on-chain registries", latency: "mainnet" },
  { city: "Circle USDC", region: "EIP-3009 transferWithAuthorization", latency: "native" },
  { city: "ERC-8004 registries", region: "Identity · Reputation · Validation", latency: "on-chain" },
  { city: "x402 facilitator", region: "Verifies, settles, pays the gas", latency: "Railway" },
  { city: "chainpe-cloud", region: "Indexer and provider dashboard", latency: "Railway" },
  { city: "ICM / Teleporter", region: "Cross-L1 sender and receiver contracts", latency: "contracts" },
];

export function InfrastructureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [activeLocation, setActiveLocation] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveLocation((prev) => (prev + 1) % locations.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground mb-6">
              <span className="w-8 h-px bg-foreground/30" />
              Infrastructure
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-8">
              Avalanche-native
              <br />
              by design.
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed mb-12">
              Sub-cent settlement, ~1–2s deterministic finality, and native Circle USDC 
              make pay-per-request economics real. Plus cross-L1 hiring over ICM/Teleporter.
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">{SETTLEMENT_GAS_USD}</div>
                <div className="text-sm text-muted-foreground">Est. gas per settlement</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">~1–2s</div>
                <div className="text-sm text-muted-foreground">Finality</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2">44</div>
                <div className="text-sm text-muted-foreground">Contract tests</div>
              </div>
            </div>
          </div>

          {/* Right: Location list */}
          <div
            className={`transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="border border-foreground/10">
              {/* Header */}
              <div className="px-6 py-4 border-b border-foreground/10 flex items-center justify-between">
                <span className="text-sm font-mono text-muted-foreground">Stack</span>
                <span className="flex items-center gap-2 text-xs font-mono text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Avalanche mainnet
                </span>
              </div>

              {/* Locations */}
              <div>
                {locations.map((location, index) => (
                  <div
                    key={location.city}
                    className={`px-6 py-5 border-b border-foreground/5 last:border-b-0 flex items-center justify-between transition-all duration-300 ${
                      activeLocation === index ? "bg-foreground/[0.02]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span 
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                          activeLocation === index ? "bg-foreground" : "bg-foreground/20"
                        }`}
                      />
                      <div>
                        <div className="font-medium">{location.city}</div>
                        <div className="text-sm text-muted-foreground">{location.region}</div>
                      </div>
                    </div>
                    <span className="font-mono text-sm text-muted-foreground">{location.latency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
