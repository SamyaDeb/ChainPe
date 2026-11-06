import { ArrowRight, Check } from "lucide-react";
import { CONTAINER, SECTION, SectionHeader } from "./section-layout";

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
    href: "https://github.com/SamyaDeb/ChainPe",
    highlight: false,
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
    highlight: false,
  },
  {
    name: "Dashboard Pro",
    description: "Paid in USDC on Arc",
    price: "19 USDC",
    period: "per 30 days",
    features: [
      "Up to 10 services",
      "Full history and CSV export",
      "Lower planned usage fee: 0.5%, not 1%",
      "Every rating, with the payer-only average",
      "Listing health history",
    ],
    cta: "Upgrade in the dashboard",
    href: "/dashboard/billing",
    highlight: true,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className={`${SECTION} border-t border-foreground/10`}>
      <div className={CONTAINER}>
        <SectionHeader
          eyebrow="Pricing"
          title="Agents pay"
          muted="your wallet."
          description="Buyers pay your wallet directly, and ChainPe charges no usage fee today. A fee is planned: 1% of verified revenue, or 0.5% on Pro, collected only from USDC you approve. Pro costs 1 USDC per 30 days on testnet."
        />

        {/* Equal columns. The buttons line up because each list takes the spare height. */}
        <div className="grid md:grid-cols-3 gap-px bg-foreground/10 border border-foreground/10">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`p-6 lg:p-10 flex flex-col ${plan.highlight ? "bg-foreground text-background" : "bg-background"}`}
            >
              <h3 className="font-display text-2xl lg:text-3xl">{plan.name}</h3>
              <p className={`mt-2 text-sm ${plan.highlight ? "text-background/70" : "text-muted-foreground"}`}>
                {plan.description}
              </p>

              <div className={`mt-8 pb-8 border-b ${plan.highlight ? "border-background/20" : "border-foreground/10"}`}>
                <div className="font-display text-4xl lg:text-5xl whitespace-nowrap">{plan.price}</div>
                <div className={`mt-2 text-sm ${plan.highlight ? "text-background/70" : "text-muted-foreground"}`}>
                  {plan.period}
                </div>
              </div>

              <ul className="mt-8 mb-10 flex-1 space-y-4">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span className={`text-sm ${plan.highlight ? "text-background/80" : "text-muted-foreground"}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                className={`h-12 px-6 rounded-full flex items-center justify-center gap-2 text-sm font-medium transition-colors group ${
                  plan.highlight
                    ? "bg-background text-foreground hover:bg-background/90"
                    : "border border-foreground/20 text-foreground hover:bg-foreground/5"
                }`}
              >
                {plan.cta}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          On Arc, gas is paid in USDC. Circle's facilitator pays settlement gas, and Gateway withdrawals carry a small fee.{" "}
          <a href="/docs/concepts/plans-and-fees" className="underline underline-offset-4 hover:text-foreground transition-colors">
            Read about plans and fees
          </a>
        </p>
      </div>
    </section>
  );
}
