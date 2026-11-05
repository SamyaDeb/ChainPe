// On-chain smoke test for a fresh ChainPeAccounts deployment on Arc testnet. Spends testnet USDC.
// It can run only once per contract, because a provider can register only once.
// Usage, from contracts-arc: node --env-file=../.env script/smoke-test.mjs <address>
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

const address = process.argv[2];
if (!address) throw new Error("Usage: smoke-test.mjs <address>");

const EXPLORER = "https://explorer.testnet.arc.io";
const NETWORK = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const abi = JSON.parse(readFileSync(new URL("../abi/ChainPeAccounts.json", import.meta.url)));
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const transport = http("https://rpc.testnet.arc.io");
const client = createPublicClient({ chain: arcTestnet, transport });
const seller = createWalletClient({ account: privateKeyToAccount(process.env.CHAINPE_SELLER_PRIVATE_KEY), chain: arcTestnet, transport });
const buyer = createWalletClient({ account: privateKeyToAccount(process.env.CHAINPE_PRIVATE_KEY), chain: arcTestnet, transport });

const read = (functionName, args = []) => client.readContract({ address, abi, functionName, args });

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`);
  console.log(`  ok: ${message}`);
}

/** Sends a transaction and returns once it is mined. `expectRevert` skips estimation so a revert lands on-chain. */
async function send(label, wallet, request, { expectRevert = false } = {}) {
  const hash = await wallet.writeContract({ address, abi, ...request, ...(expectRevert ? { gas: 1_000_000n } : {}) });
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`${label}\n  ${receipt.status}  ${EXPLORER}/tx/${hash}`);
  if (receipt.status !== (expectRevert ? "reverted" : "success")) throw new Error(`Unexpected status for ${label}: ${receipt.status}`);
  return receipt;
}

/** Simulates a call and returns the custom error name it reverts with. */
async function revertName(wallet, request) {
  try {
    await client.simulateContract({ address, abi, account: wallet.account, ...request });
  } catch (err) {
    return err.walk((e) => e.data?.errorName)?.data?.errorName;
  }
  return undefined;
}

const service = (wallet, name) => ({
  name,
  description: "ChainPe smoke test listing",
  tags: "demo,weather",
  endpoint: "https://example.com/weather",
  pricePerRequest: "0.01",
  network: NETWORK,
  payTo: wallet.account.address,
  acceptsExact: true,
  acceptsGateway: true,
});

const treasury = await read("treasury");
const price = await read("proPricePerPeriod");
console.log(`Contract ${address}\nSeller ${seller.account.address}\nBuyer ${buyer.account.address}\nTreasury ${treasury}\n`);

await send("Seller registerProvider(0)", seller, { functionName: "registerProvider", args: [0n] });

const first = service(seller, "demo-weather");
await send("Seller registerService(demo-weather)", seller, { functionName: "registerService", args: [first] });
assert((await read("providers", [seller.account.address]))[4] === 1, "seller activeServices == 1");

const second = service(seller, "demo-weather-2");
const limitError = await revertName(seller, { functionName: "registerService", args: [second] });
assert(limitError === "ServiceLimitReached", `second service on Free reverts with ${limitError}`);
await send("Seller registerService(demo-weather-2) on Free, reverts on-chain", seller, { functionName: "registerService", args: [second] }, { expectRevert: true });

const before = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [treasury] });
const approveHash = await seller.writeContract({ address: USDC, abi: erc20, functionName: "approve", args: [address, price] });
await client.waitForTransactionReceipt({ hash: approveHash });
console.log(`Seller approve(${formatUnits(price, 6)} USDC)\n  success  ${EXPLORER}/tx/${approveHash}`);
await send("Seller subscribe(1)", seller, { functionName: "subscribe", args: [1] });
const after = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [treasury] });
assert(after - before === price, `treasury received exactly ${formatUnits(after - before, 6)} USDC`);
assert((await read("planOf", [seller.account.address])) === 1, "planOf(seller) == 1");
assert((await read("maxServices", [seller.account.address])) === 10n, "maxServices(seller) == 10");

await send("Seller registerService(demo-weather-2) on Pro", seller, { functionName: "registerService", args: [second] });
assert((await read("providers", [seller.account.address]))[4] === 2, "seller activeServices == 2");
await send("Seller deactivateService(demo-weather-2)", seller, { functionName: "deactivateService", args: ["demo-weather-2"] });
assert((await read("providers", [seller.account.address]))[4] === 1, "seller activeServices == 1 after deactivate");

await send("Buyer registerProvider(0), second provider", buyer, { functionName: "registerProvider", args: [0n] });
const payToError = await revertName(buyer, { functionName: "registerService", args: [{ ...service(buyer, "buyer-demo"), payTo: seller.account.address }] });
assert(payToError === "PayToNotSender", `buyer listing the seller's payTo reverts with ${payToError}`);
await send("Buyer registerService(buyer-demo)", buyer, { functionName: "registerService", args: [service(buyer, "buyer-demo")] });

const count = await read("serviceCount");
assert(count === 3n, "serviceCount == 3");
const page = await read("getServices", [0n, 100n]);
console.log("\nFinal listings:");
for (const s of page) console.log(`  ${s.name}  active=${s.active}  provider=${s.provider}`);
