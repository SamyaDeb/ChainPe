import { CONTAINER, SECTION, SectionHeader } from "./section-layout";

const integrations = [
  { name: "Arc", category: "Blockchain" },
  { name: "Arc Studio", category: "Build" },
  { name: "Circle Facilitator", category: "Settlement" },
  { name: "Circle Gateway", category: "Nanopayments" },
  { name: "USDC (Circle)", category: "Stablecoin" },
  { name: "x402 v2", category: "Payment standard" },
  { name: "ERC-8004", category: "Reputation" },
  { name: "Agent Marketplace", category: "Discovery" },
  { name: "MetaMask", category: "Wallet" },
  { name: "Foundry", category: "Development" },
  { name: "Railway", category: "Hosting" },
  { name: "PostgreSQL", category: "Database" },
];

export function IntegrationsSection() {
  return (
    <section id="integrations" className={SECTION}>
      <div className={CONTAINER}>
        <SectionHeader
          eyebrow="Ecosystem"
          title="Works with everything"
          muted="you already use."
          description="Built on Circle's stack for Arc. Works with any HTTP API, in any language."
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10">
          {integrations.map((integration) => (
            <div key={integration.name} className="bg-background p-5 lg:p-8">
              <div className="text-base lg:text-lg font-medium">{integration.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{integration.category}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
