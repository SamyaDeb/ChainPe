/**
 * `chainpe login`: sign in with the seller key, which stays on this machine, and create an ingest key.
 * The server writes the message we sign, so it is checked before signing: see spec 08a section 1.
 */
import { getAddress, type Address, type Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";

export interface Signer {
  address: Address;
  signMessage(args: { message: string }): Promise<Hex>;
}

export type FetchLike = typeof fetch;

interface ApiError {
  error?: string;
  message?: string;
}

async function call<T>(fetchImpl: FetchLike, url: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetchImpl(url, {
    method: init.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(body.message ?? `chainpe-cloud answered ${res.status}`);
  return body;
}

/**
 * A malicious cloud URL could relay another site's challenge and keep the session, so a message
 * is signed only if it is for the host we are talking to, for this wallet, on this chain.
 */
export function assertMessageIsSafe(message: string, expected: { cloudUrl: string; address: Address; chainId: number; now?: Date }): void {
  const host = new URL(expected.cloudUrl).host;
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(message);
  } catch {
    throw new Error("Refused to sign: the server did not send a sign-in message.");
  }
  if (fields.domain !== host) throw new Error(`Refused to sign: the message is for ${fields.domain}, but you are logging in to ${host}.`);
  if (!fields.address || getAddress(fields.address) !== getAddress(expected.address)) throw new Error("Refused to sign: the message is for another wallet.");
  if (fields.chainId !== expected.chainId) throw new Error(`Refused to sign: the message is for chain ${fields.chainId}, not ${expected.chainId}.`);
  if (!fields.nonce) throw new Error("Refused to sign: the message has no nonce.");
  if (!fields.expirationTime) throw new Error("Refused to sign: the message never expires.");
  if (fields.expirationTime <= (expected.now ?? new Date())) throw new Error("Refused to sign: the message has expired.");
}

async function session(cloudUrl: string, signer: Signer, chainId: number, fetchImpl: FetchLike): Promise<string> {
  const { message } = await call<{ message: string }>(fetchImpl, `${cloudUrl}/v1/auth/nonce`, {
    body: { address: signer.address, client: "cli" },
  });
  assertMessageIsSafe(message, { cloudUrl, address: signer.address, chainId });
  const signature = await signer.signMessage({ message });
  const { token } = await call<{ token: string }>(fetchImpl, `${cloudUrl}/v1/auth/verify`, { body: { message, signature } });
  return token;
}

const endSession = (cloudUrl: string, token: string, fetchImpl: FetchLike): Promise<void> =>
  call<unknown>(fetchImpl, `${cloudUrl}/v1/auth/logout`, { token }).then(
    () => undefined,
    () => undefined
  );

export interface CreatedKey {
  id: string;
  key: string;
  prefix: string;
}

/** Signs in, creates an ingest key, and ends the session: the CLI needs only the key from then on. */
export async function loginAndCreateKey(opts: { cloudUrl: string; signer: Signer; chainId: number; fetch?: FetchLike }): Promise<CreatedKey> {
  const fetchImpl = opts.fetch ?? fetch;
  const token = await session(opts.cloudUrl, opts.signer, opts.chainId, fetchImpl);
  try {
    return await call<CreatedKey>(fetchImpl, `${opts.cloudUrl}/v1/keys`, { token, body: { name: "chainpe login" } });
  } finally {
    await endSession(opts.cloudUrl, token, fetchImpl);
  }
}

export async function revokeKey(opts: { cloudUrl: string; signer: Signer; chainId: number; keyId: string; fetch?: FetchLike }): Promise<void> {
  const fetchImpl = opts.fetch ?? fetch;
  const token = await session(opts.cloudUrl, opts.signer, opts.chainId, fetchImpl);
  try {
    await call<unknown>(fetchImpl, `${opts.cloudUrl}/v1/keys/${encodeURIComponent(opts.keyId)}`, { method: "DELETE", token });
  } finally {
    await endSession(opts.cloudUrl, token, fetchImpl);
  }
}
