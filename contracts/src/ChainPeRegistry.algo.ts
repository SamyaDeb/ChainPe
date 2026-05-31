/**
 * ChainPeRegistry — ARC4 Smart Contract
 * On-chain AI agent service registry on Algorand testnet
 *
 * Registration fee: 1 ALGO → admin wallet
 * Storage: ARC-54 BoxMap keyed by developer_address_bytes + ":" + service_name_bytes
 *
 * Methods:
 *   register(payTx, name, description, tags, endpoint, pricePerRequest, paymentToken, walletAddress, network)
 *   update(payTx, name, ...)
 *   deregister(name)
 *   getService(developer, name) → ServiceData
 *   hasService(developer, name) → bool
 *   getAdmin() → string
 *   getRegistrationFee() → uint64
 */

import type { bytes, gtxn } from "@algorandfoundation/algorand-typescript";
import {
  abimethod,
  arc4,
  assert,
  assertMatch,
  BoxMap,
  clone,
  Global,
  itxn,
  Txn,
} from "@algorandfoundation/algorand-typescript";

// ============================================================================
// Constants
// ============================================================================

const ADMIN_ADDRESS = "CIQZP6I73Q5527QWZHZLZBIDSOHVV5LMP5IEQNQYVRXYOZTQSYB7X57PBE";
const REGISTRATION_FEE = 1_000_000; // 1 ALGO in microALGO

// ============================================================================
// ServiceData Struct
// ============================================================================

class ServiceData extends arc4.Struct<{
  name: arc4.Str;
  description: arc4.Str;
  tags: arc4.Str;
  endpoint: arc4.Str;
  pricePerRequest: arc4.Str;
  paymentToken: arc4.Str;
  walletAddress: arc4.Str;
  network: arc4.Str;
  developer: arc4.Address;
  createdAt: arc4.Uint64;
  updatedAt: arc4.Uint64;
}> {}

// ============================================================================
// ChainPeRegistry Contract
// ============================================================================

export class ChainPeRegistry extends arc4.Contract {
  /**
   * BoxMap keyed by composite string: "<developer_address>:<service_name>"
   * Full box key bytes: "svc:" + key
   */
  services = BoxMap<bytes, ServiceData>({ keyPrefix: "svc:" });

  // ============================================================================
  // Lifecycle
  // ============================================================================

  @abimethod({ onCreate: "require" })
  createApplication(): void {
    // Admin address is hardcoded — no global state needed
  }

  // ============================================================================
  // Register
  // ============================================================================

  /**
   * Register a new AI agent service on-chain.
   *
   * payTx MUST be a payment of >= 1 ALGO from Txn.sender → ADMIN_ADDRESS,
   * grouped before this app call.
   */
  @abimethod()
  register(
    payTx: gtxn.PaymentTxn,
    name: arc4.Str,
    description: arc4.Str,
    tags: arc4.Str,
    endpoint: arc4.Str,
    pricePerRequest: arc4.Str,
    paymentToken: arc4.Str,
    walletAddress: arc4.Str,
    network: arc4.Str
  ): void {
    this.verifyPayment(payTx);

    const boxKey = this.makeKey(name);
    assert(!this.services(boxKey).exists, "Service already registered; use update()");

    const now = Global.latestTimestamp;

    this.services(boxKey).value = new ServiceData({
      name: name,
      description: description,
      tags: tags,
      endpoint: endpoint,
      pricePerRequest: pricePerRequest,
      paymentToken: paymentToken,
      walletAddress: walletAddress,
      network: network,
      developer: new arc4.Address(Txn.sender),
      createdAt: new arc4.Uint64(now),
      updatedAt: new arc4.Uint64(now),
    });
  }

  // ============================================================================
  // Update
  // ============================================================================

  /**
   * Update an existing service registration.
   * Only the original developer can update. Requires 1 ALGO payment.
   */
  @abimethod()
  update(
    payTx: gtxn.PaymentTxn,
    name: arc4.Str,
    description: arc4.Str,
    tags: arc4.Str,
    endpoint: arc4.Str,
    pricePerRequest: arc4.Str,
    paymentToken: arc4.Str,
    walletAddress: arc4.Str,
    network: arc4.Str
  ): void {
    this.verifyPayment(payTx);

    const boxKey = this.makeKey(name);
    assert(this.services(boxKey).exists, "Service not found; use register() first");

    const existing = clone(this.services(boxKey).value);
    assert(existing.developer.native === Txn.sender, "Only the original developer can update");

    const now = Global.latestTimestamp;

    this.services(boxKey).value = new ServiceData({
      name: name,
      description: description,
      tags: tags,
      endpoint: endpoint,
      pricePerRequest: pricePerRequest,
      paymentToken: paymentToken,
      walletAddress: walletAddress,
      network: network,
      developer: existing.developer,
      createdAt: existing.createdAt,
      updatedAt: new arc4.Uint64(now),
    });
  }

  // ============================================================================
  // Deregister
  // ============================================================================

  /**
   * Remove a service and refund box MBR. No payment required.
   * Only the original developer can deregister.
   */
  @abimethod()
  deregister(name: arc4.Str): void {
    const boxKey = this.makeKey(name);
    assert(this.services(boxKey).exists, "Service not found");

    const existing = clone(this.services(boxKey).value);
    assert(existing.developer.native === Txn.sender, "Only the original developer can deregister");

    this.services(boxKey).delete();

    // Refund released MBR back to developer
    const balance = Global.currentApplicationAddress.balance;
    const minBal = Global.currentApplicationAddress.minBalance;
    if (balance > minBal) {
      itxn
        .payment({
          receiver: Txn.sender,
          amount: balance - minBal,
          fee: 0,
        })
        .submit();
    }
  }

  // ============================================================================
  // Read-only Queries
  // ============================================================================

  /**
   * Fetch a service registration by developer address and name.
   * @param developer Algorand address string (base58-check, 58 chars)
   * @param name      Service name
   */
  @abimethod({ readonly: true })
  getService(developer: arc4.Address, name: arc4.Str): ServiceData {
    const boxKey = this.makeKeyFor(developer, name);
    assert(this.services(boxKey).exists, "Service not found");
    return this.services(boxKey).value;
  }

  /**
   * Check if a service exists.
   */
  @abimethod({ readonly: true })
  hasService(developer: arc4.Address, name: arc4.Str): arc4.Bool {
    const boxKey = this.makeKeyFor(developer, name);
    return new arc4.Bool(this.services(boxKey).exists);
  }

  /**
   * Returns the admin wallet address that receives registration fees.
   */
  @abimethod({ readonly: true })
  getAdmin(): arc4.Str {
    return new arc4.Str(ADMIN_ADDRESS);
  }

  /**
   * Returns the registration fee in microALGO.
   */
  @abimethod({ readonly: true })
  getRegistrationFee(): arc4.Uint64 {
    return new arc4.Uint64(REGISTRATION_FEE);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Box key for the current sender (Txn.sender) + service name.
   * Format: sender_address_bytes (32) + ":" + name_bytes
   */
  private makeKey(name: arc4.Str): bytes {
    return Txn.sender.bytes.concat(":").concat(name.native);
  }

  /**
   * Box key for a given developer address + service name (for read queries).
   */
  private makeKeyFor(developer: arc4.Address, name: arc4.Str): bytes {
    return developer.native.bytes.concat(":").concat(name.native);
  }

  /**
   * Verify the grouped payment transaction pays >= 1 ALGO to admin wallet.
   */
  private verifyPayment(payTx: gtxn.PaymentTxn): void {
    assertMatch(
      payTx,
      {
        sender: Txn.sender,
        receiver: new arc4.Address(ADMIN_ADDRESS).native,
        amount: { greaterThanEq: REGISTRATION_FEE },
      },
      "Payment must be >= 1 ALGO from sender to admin wallet"
    );
  }
}
