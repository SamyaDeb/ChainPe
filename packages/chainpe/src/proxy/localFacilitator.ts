/**
 * In-process x402 facilitator (optional).
 *
 * Mirrors the original "local facilitator" mode: instead of depending on an
 * external facilitator service, the provider can run one in-process. It exposes
 * the standard x402 facilitator HTTP contract (`/verify`, `/settle`,
 * `/supported`) that x402-express's `useFacilitator` calls.
 *
 * Settlement submits the payer's signed EIP-3009 `transferWithAuthorization` and
 * pays the AVAX gas, so this requires a funded EVM key. The key only pays gas and
 * relays the payer's signature — it never receives the payment (that goes to the
 * provider's `payTo`).
 */
import express, { Router, type Request, type Response } from "express";
import { createPublicClient, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verify, settle } from "x402/facilitator";
import { PaymentPayloadSchema, PaymentRequirementsSchema } from "x402/types";
import { getNetwork, type ChainPeNetwork } from "../chains.js";
import { logger } from "../logger.js";

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

export function createLocalFacilitatorRouter(privateKey: string, network: ChainPeNetwork): Router {
  const info = getNetwork(network);
  const account = privateKeyToAccount(normalizeKey(privateKey));
  const publicClient = createPublicClient({ chain: info.chain, transport: http(info.rpcUrl) });
  // x402's settle() calls verify() on this client, which needs public actions
  // (verifyTypedData, simulateContract) in addition to writeContract.
  const walletClient = createWalletClient({
    account,
    chain: info.chain,
    transport: http(info.rpcUrl),
  }).extend(publicActions);

  logger.info(`Local facilitator wallet: ${account.address} (pays gas on ${network})`);

  const router = Router();
  router.use(express.json());

  router.get("/supported", (_req: Request, res: Response) => {
    res.json({
      kinds: [{ x402Version: 1, scheme: "exact", network: info.x402Network }],
    });
  });

  router.post("/verify", async (req: Request, res: Response) => {
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await verify(publicClient as any, payload, requirements);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        isValid: false,
        invalidReason: `verify_error: ${(err as Error).message}`,
      });
    }
  });

  router.post("/settle", async (req: Request, res: Response) => {
    try {
      const payload = PaymentPayloadSchema.parse(req.body.paymentPayload);
      const requirements = PaymentRequirementsSchema.parse(req.body.paymentRequirements);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await settle(walletClient as any, payload, requirements);
      res.json(result);
    } catch (err) {
      logger.error(`[facilitator settle] ${(err as Error).stack ?? (err as Error).message}`);
      res.status(400).json({
        success: false,
        errorReason: "settle_error",
        transaction: "",
        network: info.x402Network,
        errorMessage: (err as Error).message,
      });
    }
  });

  return router;
}
