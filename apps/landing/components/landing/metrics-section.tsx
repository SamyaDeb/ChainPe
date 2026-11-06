import { CONTAINER, SECTION, SectionHeader } from "./section-layout";

const metrics = [
  { value: "101", label: "Contract tests (Foundry)" },
  { value: "307", label: "CLI and proxy tests" },
  { value: "209", label: "Cloud API tests" },
  { value: "84", label: "SDK, AI tools and wallet tests" },
];

export function MetricsSection() {
  return (
    <section id="numbers" className={`${SECTION} border-y border-foreground/10`}>
      <div className={CONTAINER}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-12 lg:mb-16">
          <SectionHeader eyebrow="By the numbers" title="Built to prove" muted="it works." className="" />
          <a
            href="https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/PROOF.md"
            className="shrink-0 inline-flex items-center gap-2 font-mono text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            <span className="w-2 h-2 rounded-full bg-green-500" />
            See live payments on Arc testnet
          </a>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10">
          {metrics.map((metric) => (
            <div key={metric.label} className="bg-background p-6 lg:p-10">
              <div className="text-5xl lg:text-7xl font-display tracking-tight">{metric.value}</div>
              <div className="mt-3 text-muted-foreground">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
