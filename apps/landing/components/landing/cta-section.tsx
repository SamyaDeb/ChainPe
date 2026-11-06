import { ArrowRight } from "lucide-react";
import { AnimatedTetrahedron } from "./animated-tetrahedron";
import { CONTAINER, SECTION, SPLIT } from "./section-layout";

export function CtaSection() {
  return (
    <section className={SECTION}>
      <div className={CONTAINER}>
        <div className="border border-foreground p-8 lg:p-16">
          <div className={`${SPLIT} items-center`}>
            <div className="min-w-0">
              <h2 className="text-4xl lg:text-6xl font-display tracking-tight">
                Ready to monetize
                <span className="block">your agents?</span>
              </h2>

              <p className="mt-6 text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-xl">
                Put a price on your API today. One command, USDC on Arc, and no usage fee today.
              </p>

              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                <a
                  href="/docs"
                  className="inline-flex items-center justify-center bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base font-medium rounded-full transition-colors group"
                >
                  Read the docs
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </a>
                <a
                  href="https://github.com/SamyaDeb/ChainPe"
                  className="inline-flex items-center justify-center h-14 px-8 text-base font-medium rounded-full border border-foreground/20 hover:bg-foreground/5 transition-colors"
                >
                  View GitHub
                </a>
              </div>
            </div>

            <div className="hidden lg:flex items-center justify-center h-[360px] overflow-hidden">
              <div className="w-[360px] h-[360px]">
                <AnimatedTetrahedron />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
