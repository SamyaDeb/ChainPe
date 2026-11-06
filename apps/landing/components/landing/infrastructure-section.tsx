import { CONTAINER, SECTION, SectionHeader, SPLIT } from "./section-layout";

const components = [
  { name: "Arc testnet", role: "Settlement network", detail: "chain 5042002" },
  { name: "Circle Facilitator", role: "Normal x402 payments", detail: "settles on Arc" },
  { name: "Circle Gateway", role: "Nanopayments", detail: "batched" },
  { name: "ChainPeAccounts", role: "Provider accounts", detail: "verified source" },
  { name: "Demo seller", role: "Live paid API", detail: "Railway" },
  { name: "chainpe-cloud", role: "Verified revenue API", detail: "Railway" },
];

const stats = [
  { value: "USDC", label: "Gas token" },
  { value: "<1s", label: "Finality" },
  { value: "~$0.001", label: "Target fee per transfer" },
];

export function InfrastructureSection() {
  return (
    <section id="infrastructure" className={SECTION}>
      <div className={CONTAINER}>
        <div className={SPLIT}>
          <div className="min-w-0 flex flex-col">
            <SectionHeader
              eyebrow="Infrastructure"
              title="Arc-native"
              muted="by design."
              description="Sub-second finality, gas paid in USDC, and settlement by Circle make pay-per-request pricing practical. Gateway nanopayments cover prices below one cent."
              className="mb-10 lg:mb-12"
            />

            <div className="mt-auto grid grid-cols-3 gap-4 lg:gap-8 pt-8 border-t border-foreground/10">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <div className="text-2xl sm:text-3xl lg:text-4xl font-display">{stat.value}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 border border-foreground/10">
            <div className="px-6 py-4 border-b border-foreground/10">
              <span className="text-sm font-mono text-muted-foreground">What runs where</span>
            </div>
            {components.map((item) => (
              <div
                key={item.name}
                className="px-6 py-4 border-b border-foreground/5 last:border-b-0 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm text-muted-foreground">{item.role}</div>
                </div>
                <span className="shrink-0 font-mono text-sm text-muted-foreground">{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
