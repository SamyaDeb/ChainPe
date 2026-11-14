"use client";

import { ArrowRight, Check } from "lucide-react";
import { REGISTRATION_FEE_USDC, SETTLEMENT_GAS_USD } from "@/lib/proof";

// Real costs only. ChainPe charges no per-request platform fee: agents pay the provider's listed
// price in USDC, providers pay a one-time registry fee, and the hosted facilitator pays settlement gas.
const plans = [
  {
    name: "Agents",
    description: "For anyone calling paid APIs",
    price: "$0",
    period: "platform fee",
    features: [
      "Pay only the listed price, in USDC",
      "Settlement gas paid by the facilitator",
      "No AVAX needed to pay",
      "Spending caps in the SDK, MCP wallet and PolicyVault",
      "Rate services on-chain (ERC-8004)",
    ],
    cta: "Read the docs",
    href: "/docs",
    popular: false,
  },
  {
    name: "Providers",
    description: "List an API on Avalanche mainnet",
    price: `${REGISTRATION_FEE_USDC} USDC`,
    period: "one-time",
    features: [
      "Listed in the on-chain ChainPeRegistry",
      "ERC-8004 identity for your service",
      "USDC paid straight to your wallet",
      "Hosted facilitator settles each call",
      "Provider dashboard for revenue and reputation",
    ],
    cta: "Open the dashboard",
    href: "/dashboard",
    popular: true,
  },
  {
    name: "Self-Hosted",
    description: "Run your own infrastructure",
    price: "Open",
    period: "source",
    features: [
      "Run your own x402 facilitator",
      "Host your own indexer",
      "Direct smart contract access",
      "Self-managed RPC endpoints",
    ],
    cta: "View GitHub",
    href: "https://github.com/SamyaDeb/ChainPe",
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
            Pay per request.
            <br />
            <span className="text-stroke">No subscriptions.</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl">
            No subscriptions and no per-request platform fee. Agents pay providers directly in USDC.
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
                  Live on mainnet
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
                {...(plan.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
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
          Settlement gas ({SETTLEMENT_GAS_USD} per settlement, estimated at 1 gwei) is paid by the hosted
          facilitator. Registering or updating a service costs a little AVAX gas.{" "}
          <a href="/docs/faq" className="underline underline-offset-4 hover:text-foreground transition-colors">
            Read the FAQ
          </a>
        </p>
      </div>
    </section>
  );
}
