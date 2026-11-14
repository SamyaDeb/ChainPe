"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  LATEST_SETTLEMENT,
  NETWORK,
  PROOF_CONTRACTS,
  addressUrl,
  fetchProofStats,
  formatUsdc,
  shortHex,
  txUrl,
  type ProofStats,
} from "@/lib/proof";

const STATS_TIMEOUT_MS = 8000;

/** Live stats from chainpe-cloud, read once in the browser. Null while loading and for good if it fails. */
function useProofStats(): ProofStats | null {
  const [stats, setStats] = useState<ProofStats | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), STATS_TIMEOUT_MS);
    fetchProofStats(ctrl.signal).then((s) => {
      if (!ctrl.signal.aborted) setStats(s);
    });
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, []);
  return stats;
}

function Chip({ children, hidden = false }: { children: ReactNode; hidden?: boolean }) {
  return (
    <span
      aria-hidden={hidden || undefined}
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-foreground/15 px-4 font-mono text-sm whitespace-nowrap transition-opacity duration-500 ${
        hidden ? "invisible opacity-0" : "opacity-100"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Verifiable proof, shown in the hero: three proof chips, live counts, contract links and the latest settlement.
 * Counts appear only once the public stats API has answered; until then (and if it fails) their space stays
 * reserved and empty, so nothing moves and no placeholder number is ever shown.
 */
export function ProofStrip() {
  const stats = useProofStats();
  return (
    <div className="border-t border-foreground/10 pt-8">
      <ul className="mb-8 flex flex-wrap gap-3" aria-label="Proof">
        <li>
          <Chip>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live on Avalanche mainnet
          </Chip>
        </li>
        <li>
          <Chip>Paid-only reviews</Chip>
        </li>
        {/* Last, so it can appear without moving the other chips. */}
        <li aria-live="polite">
          <Chip hidden={!stats}>{stats ? `${formatUsdc(stats.totalSettledAtomic)} USDC settled` : "00,000.00 USDC settled"}</Chip>
        </li>
      </ul>
      <div className="flex flex-col lg:flex-row lg:items-start gap-8 lg:gap-16">
        {/* Network + latest settlement */}
        <div className="flex flex-col gap-4 shrink-0">
          <span className="inline-flex items-center gap-2 font-mono text-sm">
            {NETWORK.name}
            <span className="text-muted-foreground">· chainId {NETWORK.chainId}</span>
          </span>
          <a
            href={txUrl(LATEST_SETTLEMENT.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-baseline gap-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span className="font-mono text-xs uppercase tracking-widest">Latest settlement</span>
            <span className="font-mono text-foreground underline-offset-4 group-hover:underline">
              {shortHex(LATEST_SETTLEMENT.hash, 10, 6)}
            </span>
            <span className="font-mono text-xs">{LATEST_SETTLEMENT.date}</span>
            <ArrowUpRight className="w-3 h-3 self-center" />
          </a>
          <p
            aria-hidden={!stats || undefined}
            className={`flex flex-wrap gap-x-8 gap-y-1 font-mono text-sm transition-opacity duration-500 ${stats ? "opacity-100" : "invisible opacity-0"}`}
          >
            <span>{stats ? stats.paidCalls.toLocaleString("en-US") : "0"} paid calls</span>
            <span>{stats ? stats.services.toLocaleString("en-US") : "0"} services</span>
            <span>{stats ? stats.verifiedReviews.toLocaleString("en-US") : "0"} verified reviews</span>
          </p>
        </div>

        {/* Verified contract links */}
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3">
          {PROOF_CONTRACTS.map((c) => (
            <li key={c.address}>
              <a
                href={addressUrl(c.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="inline-flex items-center gap-1">
                  {c.name}
                  <ArrowUpRight className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                </span>
                <span className="font-mono text-xs text-foreground/60">{shortHex(c.address)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
