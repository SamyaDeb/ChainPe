"use client";

import { AnimatedWave } from "./animated-wave";

const footerLinks = {
  Product: [
    { name: "Features", href: "#features" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Infrastructure", href: "#infrastructure" },
    { name: "Security", href: "#security" },
    { name: "Pricing", href: "#pricing" },
  ],
  Developers: [
    { name: "Documentation", href: "/docs" },
    { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPe" },
    { name: "Live demo", href: "https://chainpe-arc-demo-production.up.railway.app" },
    { name: "Proof of payments", href: "https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/PROOF.md" },
    { name: "Contract review", href: "https://github.com/SamyaDeb/ChainPe/blob/arc/docs/arc/reviews/chainpe-accounts-review.md" },
  ],
  Ecosystem: [
    { name: "Arc", href: "https://www.arc.io" },
    { name: "Circle USDC", href: "https://www.circle.com/usdc" },
    { name: "Arc Studio", href: "https://studio.arc.io/app/6872b96e-b3c0-4cdb-abe3-5f17865cdf5a" },
    { name: "Circle Gateway", href: "https://developers.circle.com/gateway" },
  ],
};

export function FooterSection() {
  return (
    <footer className="relative border-t border-foreground/10 bg-background overflow-hidden">
      {/* Animated wave background */}
      <div className="absolute inset-0 h-64 opacity-20 pointer-events-none overflow-hidden">
        <AnimatedWave />
      </div>
      
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-20">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-10 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display font-bold">ChainPe</span>
              </a>

              <p className="text-muted-foreground leading-relaxed max-w-xs">
                Payments and reputation for AI agents on Arc. 
                Monetize any API with sub-cent settlement.
              </p>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-6">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-2"
                      >
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-8 border-t border-foreground/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            2026 ChainPe. Built on Arc.
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Smart Contracts Live on Arc Testnet
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
