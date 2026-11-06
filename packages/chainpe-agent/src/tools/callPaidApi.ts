/**
 * callPaidApi: calls a URL, paying an x402 402 in USDC on Arc within the task's
 * budget. The price is checked before anything is signed.
 */
import { tool } from "ai";
import { z } from "zod";
import { ChainPe } from "@chainpearc/sdk";
import type { ChainPeNetwork, PaymentRail, PaymentReceipt } from "../types.js";

/** Longest response body handed back to the model. */
const MAX_BODY_CHARS = 8000;

/** Tracks one task's spending and the calls already made. */
export class RunBudget {
  private spentAtomic = 0n;
  private readonly seen = new Map<string, unknown>();
  readonly receipts: PaymentReceipt[] = [];

  constructor(
    private readonly maxPerCall: string,
    private readonly maxPerRun: string
  ) {}

  /** The most one payment may cost now, or undefined when the task's budget is used up. */
  cap(): string | undefined {
    const left = toAtomic(this.maxPerRun) - this.spentAtomic;
    const cap = left < toAtomic(this.maxPerCall) ? left : toAtomic(this.maxPerCall);
    return cap > 0n ? fromAtomic(cap) : undefined;
  }

  record(receipt: PaymentReceipt): void {
    this.spentAtomic += toAtomic(receipt.amount);
    this.receipts.push(receipt);
  }

  spent(): string {
    return fromAtomic(this.spentAtomic);
  }

  /** The earlier result of an identical call, so the same thing is never paid for twice in a task. */
  earlier(key: string): unknown {
    return this.seen.get(key);
  }

  remember(key: string, result: unknown): void {
    this.seen.set(key, result);
  }
}

export function toAtomic(usdc: string): bigint {
  const [whole, frac = ""] = usdc.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function fromAtomic(atomic: bigint): string {
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${atomic / 1_000_000n}${frac ? `.${frac}` : ""}`;
}

export interface CallPaidApiToolOptions {
  privateKey: string;
  network: ChainPeNetwork;
  rails?: PaymentRail[];
  accountsAddress?: string;
  reputationRegistry?: string;
  budget: RunBudget;
  onPayment?: (receipt: PaymentReceipt) => void;
}

export function createCallPaidApiTool(options: CallPaidApiToolOptions) {
  return tool({
    description:
      "Call a paid service URL. If it answers 402 Payment Required, this pays it automatically in USDC on Arc, " +
      "within the task's budget, and returns the result. Each call can cost money: call a URL once, and only " +
      "after finding it with discoverService.",
    inputSchema: z.object({
      url: z.string().url().describe("The full URL, including the path and any query, e.g. https://api.example.com/weather?city=Paris"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional().default("GET"),
      body: z.record(z.string(), z.unknown()).optional().describe("JSON body, for POST, PUT and PATCH"),
    }),
    execute: async ({ url, method, body }) => {
      const key = `${method} ${url} ${body ? JSON.stringify(body) : ""}`;
      const earlier = options.budget.earlier(key);
      if (earlier) return { ...(earlier as object), note: "Same call as before in this task, so it was not paid again." };

      const cap = options.budget.cap();
      if (!cap) {
        return { success: false, error: `The task's budget is used up (${options.budget.spent()} USDC spent). Answer with what you have.` };
      }
      try {
        const client = new ChainPe({
          privateKey: options.privateKey,
          network: options.network,
          rails: options.rails,
          accountsAddress: options.accountsAddress,
          reputationRegistry: options.reputationRegistry,
          maxPerCall: cap,
        });
        const init: RequestInit = { method };
        if (body && method !== "GET") {
          init.body = JSON.stringify(body);
          init.headers = { "content-type": "application/json" };
        }
        const { response, payment, agentId } = await client.request(url, init);
        const text = await response.text();
        let data: unknown = text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…(truncated)` : text;
        try {
          if (text.length <= MAX_BODY_CHARS) data = JSON.parse(text);
        } catch {
          /* Not JSON: keep the text. */
        }

        let receipt: PaymentReceipt | undefined;
        if (payment) {
          const parsed = new URL(url);
          receipt = {
            txId: payment.txHash,
            transferId: payment.transferId,
            amount: payment.amount,
            token: "USDC",
            rail: payment.rail,
            recipient: payment.recipient,
            timestamp: new Date(),
            service: parsed.origin,
            path: `${parsed.pathname}${parsed.search}`,
            agentId,
          };
          options.budget.record(receipt);
          options.onPayment?.(receipt);
        }
        const result = {
          success: response.ok,
          status: response.status,
          data,
          paid: Boolean(payment),
          payment: receipt && { amount: `${receipt.amount} USDC`, rail: receipt.rail, txId: receipt.txId, transferId: receipt.transferId },
        };
        if (response.ok) options.budget.remember(key, result);
        return result;
      } catch (error) {
        return { success: false, error: `Call failed: ${(error as Error).message}` };
      }
    },
  });
}
