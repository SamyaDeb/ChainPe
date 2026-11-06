import { Shield, Lock, Eye, FileCheck } from "lucide-react";
import { CONTAINER, SECTION, SectionHeader, SPLIT } from "./section-layout";

const securityFeatures = [
  {
    icon: Shield,
    title: "Non-custodial settlement",
    description: "Buyers pay your wallet directly. Circle's facilitator settles the signed USDC payment and pays the gas. ChainPe never holds funds.",
  },
  {
    icon: Lock,
    title: "Paid before served",
    description: "The proxy settles every payment before it calls your API. Pending or failed payments never reach your backend.",
  },
  {
    icon: Eye,
    title: "Self-feedback resistant",
    description: "ERC-8004 on Arc blocks self-rating. Your dashboard separates ratings from wallets that actually paid you.",
  },
  {
    icon: FileCheck,
    title: "Reviewed contract",
    description: "ChainPeAccounts was reviewed before launch: no High findings, one Medium found and fixed, 101 Foundry tests, source verified on the Arc explorer.",
  },
];

const standards = ["x402 v2", "EIP-3009", "ERC-8004", "EIP-712", "OpenZeppelin"];

export function SecuritySection() {
  return (
    <section id="security" className={`${SECTION} bg-foreground/[0.02]`}>
      <div className={CONTAINER}>
        <div className={SPLIT}>
          <div className="min-w-0">
            <SectionHeader
              eyebrow="Security"
              title="Trust is"
              muted="non-negotiable."
              description="Non-custodial by design. Settled before your API runs. Reviewed contract."
              className="mb-8 lg:mb-10"
            />

            <div className="flex flex-wrap gap-3">
              {standards.map((standard) => (
                <span key={standard} className="px-4 py-2 border border-foreground/10 text-sm font-mono">
                  {standard}
                </span>
              ))}
            </div>
          </div>

          {/* One height for every row */}
          <div className="min-w-0 grid auto-rows-fr gap-px bg-foreground/10 border border-foreground/10">
            {securityFeatures.map((feature) => (
              <div key={feature.title} className="bg-background p-6 flex items-start gap-4">
                <div className="shrink-0 w-10 h-10 flex items-center justify-center border border-foreground/10">
                  <feature.icon className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-medium mb-1">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
