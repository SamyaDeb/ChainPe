"use client";

import { ArrowUpRight } from "lucide-react";
import { AnimatedWave } from "./animated-wave";

const footerLinks = {
  Product: [
    { name: "Features", href: "#features" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Infrastructure", href: "#studio" },
    { name: "Security", href: "#security" },
  ],
  Developers: [
    { name: "Documentation", href: "https://chainpe.xyz/docs" },
    { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPe" },
    { name: "SDK Packages", href: "https://www.npmjs.com/org/chainpeavax" },
    { name: "Mainnet", href: "#" },
  ],
  Ecosystem: [
    { name: "Avalanche C-Chain", href: "#" },
    { name: "Circle USDC", href: "#" },
    { name: "Teleporter", href: "#" },
    { name: "Vercel AI SDK", href: "#" },
  ],
  Legal: [
    { name: "Privacy Policy", href: "#" },
    { name: "Terms of Service", href: "#" },
    { name: "Smart Contract Audit", href: "#security" },
  ],
};

const socialLinks = [
  { name: "X (Twitter)", href: "#" },
  { name: "GitHub", href: "https://github.com/SamyaDeb/ChainPe" },
  { name: "Discord", href: "#" },
];

export function FooterSection() {
  return (
    <footer className="relative border-t border-foreground/10 bg-background overflow-hidden">
      {/* Animated wave background */}
      <div className="absolute inset-0 h-64 opacity-20 pointer-events-none overflow-hidden">
        <AnimatedWave />
      </div>
      
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-24">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <span className="text-2xl font-display font-bold">ChainPe</span>
              </a>

              <p className="text-muted-foreground leading-relaxed mb-8 max-w-xs">
                Payment and reputation infrastructure for the Avalanche agent economy. 
                Monetize any API with sub-cent settlement.
              </p>

              {/* Social Links */}
              <div className="flex gap-6">
                {socialLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 group"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.name}
                    <ArrowUpRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                ))}
              </div>
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
            2025 ChainPe. Built for the Avalanche ecosystem.
          </p>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Smart Contracts Live on Mainnet
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
