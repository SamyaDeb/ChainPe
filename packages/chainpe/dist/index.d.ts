import { PaymentRequirements } from '@x402-avm/core/types';
import { Express } from 'express';
import { RoutesConfig, HTTPFacilitatorClient } from '@x402-avm/core/server';
export { RoutesConfig } from '@x402-avm/core/server';
import algosdk from 'algosdk';

/**
 * ChainPe Provider Types
 * Algorand-native types for x402 payment gateway
 */

declare const ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
declare const ALGORAND_MAINNET_CAIP2 = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
declare const ALGORAND_WILDCARD_CAIP2 = "algorand:*";
declare const USDC_TESTNET_ASA_ID = 10458941;
declare const USDC_MAINNET_ASA_ID = 31566704;
declare const USDC_DECIMALS = 6;
declare const ALGO_DECIMALS = 6;
declare const ALGOD_TESTNET_URL = "https://testnet-api.algonode.cloud";
declare const ALGOD_MAINNET_URL = "https://mainnet-api.algonode.cloud";
declare const FACILITATOR_URL = "https://facilitator.x402.goplausible.xyz";
type PaymentToken = "ALGO" | "USDC";
interface TokenInfo {
    symbol: PaymentToken;
    decimals: number;
    asaId?: number;
    name: string;
}
declare const TOKENS: Record<PaymentToken, TokenInfo>;
interface ChainPeConfig {
    serviceName: string;
    serviceDescription: string;
    tags: string[];
    targetUrl: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    mnemonic?: string;
    proxyPort: number;
    network: "testnet" | "mainnet";
    registryAppId?: string;
    logLevel?: "verbose" | "normal" | "quiet";
    adminKey?: string;
    rateLimit?: number;
}
interface ServiceRegistration {
    id: string;
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    createdAt: string;
    updatedAt: string;
}
interface Registry {
    version: string;
    services: ServiceRegistration[];
}
interface RouteConfig {
    path: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    description?: string;
}
interface ResolvedRoute {
    path: string;
    requirements: PaymentRequirements;
}
interface RequestStats {
    totalRequests: number;
    paidRequests: number;
    failedPayments: number;
    totalRevenue: bigint;
    revenueByToken: Record<PaymentToken, bigint>;
    requestsPerMinute: number[];
    lastHourRequests: number;
}
interface PaymentEvent {
    timestamp: Date;
    path: string;
    amount: string;
    token: PaymentToken;
    payer: string;
    txId?: string;
    success: boolean;
    error?: string;
}
interface ServerState {
    isRunning: boolean;
    startedAt?: Date;
    config: ChainPeConfig;
    stats: RequestStats;
    recentPayments: PaymentEvent[];
}
interface InitAnswers {
    targetUrl: string;
    serviceName: string;
    serviceDescription: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    tags: string;
    walletAddress: string;
    mnemonic: string;
    proxyPort: number;
}
type LogLevel = "verbose" | "normal" | "quiet";
interface Logger {
    verbose: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    success: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
}

/**
 * Analytics Module
 * Tracks payment events and request statistics
 */

declare class Analytics {
    private stats;
    private recentPayments;
    private minuteRequests;
    private currentMinute;
    constructor();
    /**
     * Records a request (paid or unpaid)
     */
    recordRequest(): void;
    /**
     * Records a successful payment
     */
    recordPayment(event: PaymentEvent): void;
    /**
     * Updates per-minute request tracking
     */
    private updateMinuteStats;
    /**
     * Gets current statistics
     */
    getStats(): RequestStats;
    /**
     * Gets recent payment events
     */
    getRecentPayments(): PaymentEvent[];
    /**
     * Gets formatted revenue summary
     */
    getRevenueSummary(): Record<PaymentToken, string>;
    /**
     * Resets all statistics
     */
    reset(): void;
}
declare const analytics: Analytics;

/**
 * ChainPe Proxy Server
 * x402 payment gateway for Algorand using the GoPlausible x402-avm libraries
 *
 * Supports two modes:
 * 1. Simple verifier (default) - verifies payments by checking Algorand blockchain
 * 2. Local facilitator (when mnemonic is provided) - runs in-process with signing
 */

interface ProxyServerOptions {
    config: ChainPeConfig;
    additionalRoutes?: RouteConfig[];
    onPayment?: (event: PaymentEvent) => void;
    /** Optional mnemonic for local facilitator mode (enables gasless transactions) */
    facilitatorMnemonic?: string;
}
/**
 * Creates and configures the x402 proxy server
 */
declare function createProxyServer(options: ProxyServerOptions): Express;
/**
 * Starts the proxy server
 */
declare function startProxyServer(options: ProxyServerOptions): Promise<{
    app: Express;
    server: ReturnType<Express["listen"]>;
}>;

/**
 * Route Configuration
 * Defines x402 payment requirements for protected routes
 */

/**
 * Internal type for route display
 */
interface RouteDisplayInfo {
    path: string;
    price: string;
    token: string;
    decimals: number;
}
/**
 * Creates a routes map for the x402 middleware
 */
declare function createRoutesConfig(config: ChainPeConfig, additionalRoutes?: RouteConfig[]): RoutesConfig;
/**
 * Formats routes for display in the CLI
 */
declare function formatRoutesForDisplay(routes: RoutesConfig): RouteDisplayInfo[];

/**
 * Algorand Facilitator Client
 * Connects to the GoPlausible x402 facilitator for Algorand payments
 */

interface AlgorandFacilitatorOptions {
    network: "testnet" | "mainnet";
    facilitatorUrl?: string;
}
/**
 * Creates an HTTP facilitator client for x402 payment verification
 */
declare function createFacilitatorClient(options: AlgorandFacilitatorOptions): HTTPFacilitatorClient;
/**
 * Creates an Algod client for interacting with the Algorand network
 */
declare function createAlgodClient(network: "testnet" | "mainnet"): algosdk.Algodv2;
/**
 * Validates an Algorand wallet address (58-char base32)
 */
declare function isValidAlgorandAddress(address: string): boolean;
/**
 * Validates a 25-word Algorand mnemonic
 */
declare function isValidMnemonic(mnemonic: string): boolean;
/**
 * Derives wallet address from mnemonic
 */
declare function addressFromMnemonic(mnemonic: string): string;
/**
 * Gets account info from the Algorand network
 */
declare function getAccountInfo(algod: algosdk.Algodv2, address: string): Promise<{
    balance: bigint;
    minBalance: bigint;
    assets: Array<{
        assetId: bigint;
        amount: bigint;
    }>;
}>;
/**
 * Formats microAlgos to ALGO with proper decimals
 */
declare function formatAlgo(microAlgos: bigint, decimals?: number): string;
/**
 * Parses a human-readable amount to microunits
 */
declare function parseAmount(amount: string, decimals?: number): bigint;

/**
 * ChainPe On-Chain Registry Client
 *
 * Reads from and writes to the deployed ChainPeRegistry smart contract on Algorand.
 * Uses raw algosdk v3 — no algokit-utils required.
 *
 * App ID priority:
 *   1. CHAINPE_REGISTRY_APP_ID environment variable
 *   2. registryAppId field in ~/.chainpe/config.json
 *   3. Default fallback (757397216)
 */

interface RegistrationResult {
    txnHash: string;
    appId: bigint;
    appAddress: string;
}
interface OnChainService {
    name: string;
    description: string;
    tags: string[];
    endpoint: string;
    pricePerRequest: string;
    paymentToken: PaymentToken;
    walletAddress: string;
    network: "testnet" | "mainnet";
    developer: string;
    createdAt: number;
    updatedAt: number;
}
declare class ChainPeRegistryClient {
    private algod;
    readonly appId: bigint;
    readonly appAddress: string;
    constructor(network?: "testnet" | "mainnet");
    /**
     * Registers (or updates) a service on-chain.
     *
     * Step 1: Fund the app address with enough ALGO to cover box MBR (standalone tx).
     * Step 2: Atomic group:
     *   [0] PaymentTxn  → ADMIN (1 ALGO registration fee) — this is `payTx`
     *   [1] AppCallTxn  → register() or update()
     */
    registerService(params: {
        mnemonic: string;
        name: string;
        description: string;
        tags: string[];
        endpoint: string;
        pricePerRequest: string;
        paymentToken: PaymentToken;
        walletAddress: string;
        network: "testnet" | "mainnet";
        isUpdate?: boolean;
    }): Promise<RegistrationResult>;
    /**
     * Fetches a service from on-chain using algod simulate (read-only, no fee).
     * Returns null if the service does not exist.
     */
    getService(developerAddress: string, serviceName: string): Promise<OnChainService | null>;
    /** Returns true if a service exists for the given developer+name. */
    hasService(developerAddress: string, serviceName: string): Promise<boolean>;
    /** Contract info for display. */
    getContractInfo(): {
        appId: bigint;
        appAddress: string;
    };
}
declare function onChainToServiceRegistration(svc: OnChainService): ServiceRegistration;

/**
 * ChainPe Logger
 * Beautiful, structured logging with colors and icons
 */

declare function setLogLevel(level: LogLevel): void;
declare function getLogLevel(): LogLevel;
declare const logger: Logger;
declare const logPayment: (amount: string, token: string, payer: string, path: string) => void;
declare const logRequest: (method: string, path: string, status: number, duration: number) => void;
declare const logServerStart: (port: number, serviceName: string) => void;

export { ALGOD_MAINNET_URL, ALGOD_TESTNET_URL, ALGORAND_MAINNET_CAIP2, ALGORAND_TESTNET_CAIP2, ALGORAND_WILDCARD_CAIP2, ALGO_DECIMALS, Analytics, type ChainPeConfig, ChainPeRegistryClient, FACILITATOR_URL, type InitAnswers, type LogLevel, type Logger, type OnChainService, type PaymentEvent, type PaymentToken, type RegistrationResult, type Registry, type RequestStats, type ResolvedRoute, type RouteConfig, type ServerState, type ServiceRegistration, TOKENS, type TokenInfo, USDC_DECIMALS, USDC_MAINNET_ASA_ID, USDC_TESTNET_ASA_ID, addressFromMnemonic, analytics, createAlgodClient, createFacilitatorClient, createProxyServer, createRoutesConfig, formatAlgo, formatRoutesForDisplay, getAccountInfo, getLogLevel, isValidAlgorandAddress, isValidMnemonic, logPayment, logRequest, logServerStart, logger, onChainToServiceRegistration, parseAmount, setLogLevel, startProxyServer };
