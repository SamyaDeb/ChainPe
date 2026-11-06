"use client";

import { ArrowRight, Check } from "lucide-react";

const plans = [
  {
    name: "Open source",
    description: "CLI, proxy and SDK",
    price: "Free",
    period: "forever",
    features: [
      "One-command x402 proxy",
      "Normal x402 and Gateway nanopayments",
      "Settled by Circle on Arc",
      "chainpe doctor listing checks",
      "MIT licensed",
    ],
    cta: "View GitHub",
    href: "https://github.com/SamyaDeb/ChainPeAvax",
    popular: false,
  },
  {
    name: "Dashboard Pro",
    description: "Paid in USDC on Arc",
    price: "19 USDC",
    period: "per 30 days",
    features: [
      "Up to 10 services",
      "Full history and CSV export",
      "0.5% usage fee on verified revenue, not 1%",
      "Every rating, with the payer-only average",
      "Listing health history",
    ],
    cta: "Upgrade in the dashboard",
    href: "/dashboard/billing",
    popular: true,
  },
  {
    name: "Dashboard Free",
    description: "For every registered provider",
    price: "Free",
    period: "forever",
    features: [
      "1 service",
      "Last 7 days of revenue",
      "Verified and unverified totals",
      "Top 5 buyers",
      "Average rating",
    ],
    cta: "Register a provider",
    href: "/dashboard",
    popular: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative py-32 lg:py-40 border-t border-foreground/10">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="max-w-3xl mb-20">
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase block mb-6">
            Pricing
          </span>
          <h2 className="font-display text-5xl md:text-6xl lg:text-7xl tracking-tight text-foreground mb-6">
            Keep 99% of
            <br />
            <span className="text-stroke">what agents pay.</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl">
            Buyers pay your wallet directly. ChainPe takes 1% of verified revenue, or 0.5% on Pro (1 USDC per 30 days on testnet), collected from USDC you approve. You can revoke it at any time.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-px bg-foreground/10">
          {plans.map((plan, idx) => (
            <div
              key={plan.name}
              className={`relative p-8 lg:p-12 bg-background ${
                plan.popular ? "md:-my-4 md:py-12 lg:py-16 border-2 border-foreground" : ""
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-8 px-3 py-1 bg-foreground text-primary-foreground text-xs font-mono uppercase tracking-widest">
                  Pro
                </span>
              )}

              {/* Plan Header */}
              <div className="mb-8">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-3xl text-foreground mt-2">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-8 pb-8 border-b border-foreground/10">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-5xl lg:text-6xl text-foreground">
                    {plan.price}
                  </span>
                  <span className="text-muted-foreground">/{plan.period}</span>
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-4 mb-10">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-4 h-4 text-foreground mt-0.5 shrink-0" />
                    <span className="text-sm text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href={plan.href}
                className={`w-full py-4 flex items-center justify-center gap-2 text-sm font-medium transition-all group ${
                  plan.popular
                    ? "bg-foreground text-primary-foreground hover:bg-foreground/90"
                    : "border border-foreground/20 text-foreground hover:border-foreground hover:bg-foreground/5"
                }`}
              >
                {plan.cta}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          ))}
        </div>

        {/* Bottom Note */}
        <p className="mt-12 text-center text-sm text-muted-foreground">
          Note: on Arc, gas is paid in USDC. Circle's facilitator pays settlement gas; Gateway withdrawals carry a small fee.{" "}
          <a href="https://github.com/SamyaDeb/ChainPeAvax/blob/arc/docs/arc/BUSINESS-MODEL.md" className="underline underline-offset-4 hover:text-foreground transition-colors">
            Read the business model
          </a>
        </p>
      </div>
    </section>
  );
}
