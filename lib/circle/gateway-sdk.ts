/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from "crypto";
import {
  http,
  maxUint256,
  zeroAddress,
  pad,
  createPublicClient,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Chain,
} from "viem";
import * as chains from "viem/chains";
import { circleDeveloperSdk } from "@/lib/circle/sdk";
import {
  Transaction,
  Blockchain,
  type CreateContractExecutionTransactionInput,
} from "@circle-fin/developer-controlled-wallets";

export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

// Optional. Without a key, this uses the public Arc Testnet RPC.
const arcRpcKey = process.env.ARC_TESTNET_RPC_KEY ?? '';

export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [`https://rpc.testnet.arc.io/${arcRpcKey}`] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: 'https://explorer.testnet.arc.io' },
  },
  testnet: true,
} as const satisfies Chain;

export const USDC_ADDRESSES = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export const DOMAIN_IDS = {
  avalancheFuji: 1,
  baseSepolia: 6,
  arcTestnet: 26,
} as const;

export type SupportedChain = keyof typeof USDC_ADDRESSES;

// Mapping for Circle API "blockchain" parameter
export const CIRCLE_CHAIN_NAMES: Record<SupportedChain, Blockchain> = {
  avalancheFuji: Blockchain.AvaxFuji,
  baseSepolia: Blockchain.BaseSepolia,
  arcTestnet: Blockchain.ArcTestnet,
};

export const CHAIN_BY_DOMAIN: Record<number, SupportedChain> = {
  [DOMAIN_IDS.avalancheFuji]: "avalancheFuji",
  [DOMAIN_IDS.baseSepolia]: "baseSepolia",
  [DOMAIN_IDS.arcTestnet]: "arcTestnet",
} as const;

function getChainConfig(chain: SupportedChain): Chain {
  switch (chain) {
    case "arcTestnet":
      return arcTestnet;
    case "avalancheFuji":
      return chains.avalancheFuji;
    case "baseSepolia":
      return chains.baseSepolia;
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

// Only the read functions this app calls. Writes go through Circle (abiFunctionSignature).
const gatewayWalletAbi = [
  {
    type: "function",
    name: "isAuthorizedForBalance",
    inputs: [
      { name: "token", type: "address", internalType: "address" },
      { name: "depositor", type: "address", internalType: "address" },
      { name: "addr", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
] as const;

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
] as const;

const TransferSpec = [
  { name: "version", type: "uint32" },
  { name: "sourceDomain", type: "uint32" },
  { name: "destinationDomain", type: "uint32" },
  { name: "sourceContract", type: "bytes32" },
  { name: "destinationContract", type: "bytes32" },
  { name: "sourceToken", type: "bytes32" },
  { name: "destinationToken", type: "bytes32" },
  { name: "sourceDepositor", type: "bytes32" },
  { name: "destinationRecipient", type: "bytes32" },
  { name: "sourceSigner", type: "bytes32" },
  { name: "destinationCaller", type: "bytes32" },
  { name: "value", type: "uint256" },
  { name: "salt", type: "bytes32" },
  { name: "hookData", type: "bytes" },
] as const;

const BurnIntent = [
  { name: "maxBlockHeight", type: "uint256" },
  { name: "maxFee", type: "uint256" },
  { name: "spec", type: "TransferSpec" },
] as const;

function addressToBytes32(address: Address): `0x${string}` {
  return pad(address.toLowerCase() as Address, { size: 32 });
}

interface BurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Address;
  destinationContract: Address;
  sourceToken: Address;
  destinationToken: Address;
  sourceDepositor: Address;
  destinationRecipient: Address;
  sourceSigner: Address;
  destinationCaller: Address;
  value: bigint;
  salt: `0x${string}`;
  hookData: `0x${string}`;
}

interface BurnIntentData {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: BurnIntentSpec;
}

function burnIntentTypedData(burnIntent: BurnIntentData) {
  const domain = {
    name: "GatewayWallet",
    version: "1",
  };
  return {
    types: { EIP712Domain, TransferSpec, BurnIntent },
    domain,
    primaryType: "BurnIntent" as const,
    message: {
      ...burnIntent,
      spec: {
        ...burnIntent.spec,
        sourceContract: addressToBytes32(burnIntent.spec.sourceContract),
        destinationContract: addressToBytes32(burnIntent.spec.destinationContract),
        sourceToken: addressToBytes32(burnIntent.spec.sourceToken),
        destinationToken: addressToBytes32(burnIntent.spec.destinationToken),
        sourceDepositor: addressToBytes32(burnIntent.spec.sourceDepositor),
        destinationRecipient: addressToBytes32(burnIntent.spec.destinationRecipient),
        sourceSigner: addressToBytes32(burnIntent.spec.sourceSigner),
        destinationCaller: addressToBytes32(burnIntent.spec.destinationCaller),
      },
    },
  };
}

const GATEWAY_API_URL = "https://gateway-api-testnet.circle.com/v1";

// Circle states after which a transaction will never confirm.
const FAILED_TX_STATES = new Set(["FAILED", "CANCELLED", "DENIED", "STUCK"]);
const TX_POLL_INTERVAL_MS = 2_000;
export const TX_CONFIRMATION_TIMEOUT_MS = 3 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls a Circle transaction until it is on-chain. Throws if Circle gives up on it
 * (FAILED, CANCELLED, DENIED or STUCK) or if it is not confirmed within `timeoutMs`.
 */
export async function waitForTransactionConfirmation(
  challengeId: string,
  { timeoutMs = TX_CONFIRMATION_TIMEOUT_MS, intervalMs = TX_POLL_INTERVAL_MS } = {}
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const response = await circleDeveloperSdk.getTransaction({ id: challengeId });
    const tx = response.data?.transaction;

    if (tx?.state === "CONFIRMED" || tx?.state === "COMPLETE") {
      console.log(`Transaction ${challengeId} reached terminal state '${tx.state}' with hash: ${tx.txHash}`);
      if (!tx.txHash) {
        throw new Error(`Transaction ${challengeId} is ${tx.state} but txHash is missing.`);
      }
      return tx.txHash;
    }
    if (tx?.state && FAILED_TX_STATES.has(tx.state)) {
      console.error("Circle API Error:", tx);
      const details = tx.errorDetails ? ` (${tx.errorDetails})` : "";
      throw new Error(
        `Transaction ${challengeId} ${tx.state.toLowerCase()} with reason: ${tx.errorReason ?? "none"}${details}`
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Transaction ${challengeId} not confirmed within ${Math.round(timeoutMs / 1000)}s (last state: ${tx?.state ?? "unknown"})`
      );
    }

    console.log(`Transaction ${challengeId} state: ${tx?.state}. Polling again in ${intervalMs / 1000}s...`);
    await sleep(intervalMs);
  }
}

/**
 * Starts a contract call from a Circle wallet on `blockchain`. The user's wallets share one
 * address on every chain but have a different Circle wallet ID per chain, so the wallet is
 * picked by address + blockchain: a wallet ID alone always runs on that wallet's own chain.
 */
async function initiateContractInteraction(
  walletAddress: Address,
  blockchain: Blockchain,
  contractAddress: Address,
  abiFunctionSignature: string,
  abiParameters: string[],
  feeLevel: "MEDIUM" | "HIGH" = "HIGH"
): Promise<string> {
  const input: CreateContractExecutionTransactionInput = {
    walletAddress,
    blockchain,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: { type: "level", config: { feeLevel } },
  };
  const response = await circleDeveloperSdk.createContractExecutionTransaction(input);

  if (!response.data?.id) {
    console.error("Circle API Error: Challenge ID not found in response", response.data);
    throw new Error("Circle API did not return a Challenge ID.");
  }

  return response.data.id;
}

/** True if `delegate` may already sign burn intents for `depositor`'s USDC on `chain`. */
export async function isGatewayDelegate(
  depositor: Address,
  delegate: Address,
  chain: SupportedChain
): Promise<boolean> {
  const publicClient = createPublicClient({ chain: getChainConfig(chain), transport: http() });
  return publicClient.readContract({
    address: GATEWAY_WALLET_ADDRESS,
    abi: gatewayWalletAbi,
    functionName: "isAuthorizedForBalance",
    args: [USDC_ADDRESSES[chain], depositor, delegate],
  });
}

/**
 * Deposits USDC from the user's SCA into the Gateway Wallet on `chain`. If `delegateAddress`
 * is given and is not yet a delegate on that chain, it is added first, so it can sign burn
 * intents for this balance. The caller checks the wallet holds `amountInAtomicUnits` first.
 */
export async function initiateDepositFromCustodialWallet(
  walletAddress: Address,
  chain: SupportedChain,
  amountInAtomicUnits: bigint,
  delegateAddress?: Address
): Promise<string> {
  if (amountInAtomicUnits <= BigInt(0)) {
    throw new Error("Deposit amount must be positive");
  }
  const usdcAddress = USDC_ADDRESSES[chain];
  const blockchain = CIRCLE_CHAIN_NAMES[chain];

  // Step 1: add the delegate once per chain (allows the EOA to sign burn intents)
  if (delegateAddress && !(await isGatewayDelegate(walletAddress, delegateAddress, chain))) {
    console.log(`Step 1: Adding delegate ${delegateAddress} for ${walletAddress} on ${blockchain}...`);
    const addDelegateChallengeId = await initiateContractInteraction(
      walletAddress,
      blockchain,
      GATEWAY_WALLET_ADDRESS,
      "addDelegate(address,address)",
      [usdcAddress, delegateAddress]
    );
    const delegateTxHash = await waitForTransactionConfirmation(addDelegateChallengeId);
    console.log(`Delegate added successfully. TxHash: ${delegateTxHash}`);
  }

  console.log(`Step 2: Approving Gateway contract for ${walletAddress} on ${blockchain}...`);
  const approvalChallengeId = await initiateContractInteraction(
    walletAddress,
    blockchain,
    usdcAddress,
    "approve(address,uint256)",
    [GATEWAY_WALLET_ADDRESS, amountInAtomicUnits.toString()]
  );
  await waitForTransactionConfirmation(approvalChallengeId);

  console.log(`Step 3: Calling deposit function on Gateway for ${walletAddress} on ${blockchain}...`);
  const depositChallengeId = await initiateContractInteraction(
    walletAddress,
    blockchain,
    GATEWAY_WALLET_ADDRESS,
    "deposit(address,uint256)",
    [usdcAddress, amountInAtomicUnits.toString()]
  );
  const depositTxHash = await waitForTransactionConfirmation(depositChallengeId);

  console.log("Custodial deposit successful. Final TxHash:", depositTxHash);
  return depositTxHash;
}

type SignedTypedData = ReturnType<typeof burnIntentTypedData>;

export async function submitBurnIntent(
  burnIntent: SignedTypedData["message"],
  signature: `0x${string}`
): Promise<{
  attestation: `0x${string}`;
  attestationSignature: `0x${string}`;
  transferId: string;
}> {
  const payload = [
    {
      burnIntent: {
        maxBlockHeight: burnIntent.maxBlockHeight.toString(),
        maxFee: burnIntent.maxFee.toString(),
        spec: {
          ...burnIntent.spec,
          value: burnIntent.spec.value.toString(),
        },
      },
      signature,
    },
  ];

  const response = await fetch(`${GATEWAY_API_URL}/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    attestation: result.attestation as `0x${string}`,
    attestationSignature: result.signature as `0x${string}`,
    transferId: result.transferId,
  };
}

/**
 * Calls `gatewayMint` on the destination chain from `minterAddress` (the user's SCA, whose gas
 * Circle Gas Station pays, or their EOA, which pays its own gas).
 */
export async function executeMintCircle(
  minterAddress: Address,
  destinationChain: SupportedChain,
  attestation: string,
  signature: string
): Promise<Transaction> {
  const blockchain = CIRCLE_CHAIN_NAMES[destinationChain];
  if (!blockchain) throw new Error(`No Circle blockchain mapping for ${destinationChain}`);

  let challengeId: string;
  try {
    challengeId = await initiateContractInteraction(
      minterAddress,
      blockchain,
      GATEWAY_MINTER_ADDRESS,
      "gatewayMint(bytes,bytes)",
      [attestation, signature],
      "MEDIUM"
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Circle API error during mint:", message);

    // 155258: the minting wallet cannot pay for gas
    if ((error as { code?: unknown })?.code === 155258) {
      throw new Error(`INSUFFICIENT_GAS:${minterAddress}:${blockchain}`);
    }
    throw new Error(`Failed to execute mint transaction: ${message}`);
  }

  // Wait for transaction confirmation to get the txHash
  console.log(`Waiting for mint transaction ${challengeId} to confirm...`);
  const txHash = await waitForTransactionConfirmation(challengeId);

  // Fetch the final transaction object
  const tx = await circleDeveloperSdk.getTransaction({ id: challengeId });
  if (!tx?.data?.transaction) {
    throw new Error(`Failed to fetch transaction ${challengeId}`);
  }

  // Ensure txHash is set
  const transaction = tx.data.transaction;
  if (!transaction.txHash) {
    transaction.txHash = txHash;
  }

  return transaction;
}

/**
 * Get the Circle wallet ID and address of the user's EOA signer (the same on every chain)
 */
async function getSignerWalletIdForUser(
  userId: string
): Promise<{ walletId: string; address: string }> {
  const { getGatewayEOAWalletId } = await import("@/lib/circle/create-gateway-eoa-wallets");
  return await getGatewayEOAWalletId(userId);
}

/**
 * Check if a wallet has native token balance for gas fees on `chain`.
 * Only needed for EOAs: Circle Gas Station pays the gas of the user's SCA.
 */
export async function checkWalletGasBalance(
  walletAddress: Address,
  chain: SupportedChain
): Promise<{ hasGas: boolean; address: string; balance: string }> {
  const publicClient = createPublicClient({
    chain: getChainConfig(chain),
    transport: http(),
  });

  const balance = await publicClient.getBalance({ address: walletAddress });

  return {
    hasGas: balance > BigInt(0),
    address: walletAddress,
    balance: balance.toString(),
  };
}

/** JSON can't carry bigint, so Circle's signTypedData gets them as decimal strings. */
function serializeBigInt(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInt);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, serializeBigInt(inner)])
    );
  }
  return value;
}

async function signBurnIntentWithEOA(
  burnIntentData: BurnIntentData,
  userId: string
): Promise<`0x${string}`> {
  const typedData = burnIntentTypedData(burnIntentData);

  const { walletId, address } = await getSignerWalletIdForUser(userId);

  console.log("Signing burn intent with EOA:", address);

  // Use Circle SDK to sign the typed data
  const response = await circleDeveloperSdk.signTypedData({
    walletId,
    data: JSON.stringify(serializeBigInt(typedData)),
  });

  if (!response.data?.signature) {
    throw new Error("Failed to sign burn intent with Circle SDK");
  }

  return response.data.signature as `0x${string}`;
}

/** Thrown before signing when the source chain's Gateway balance can't cover amount + fee. */
export class InsufficientGatewayBalanceError extends Error {
  constructor(
    readonly chain: SupportedChain,
    readonly required: bigint,
    readonly available: bigint,
    readonly fee: bigint
  ) {
    super(
      `Insufficient Gateway balance on ${chain}: this transfer needs ${formatUnits(required, 6)} USDC ` +
        `(including a ${formatUnits(fee, 6)} USDC fee) but ${formatUnits(available, 6)} USDC is available.`
    );
    this.name = "InsufficientGatewayBalanceError";
  }
}

function buildBurnIntent(
  amount: bigint,
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress: Address,
  depositorAddress: Address,
  signerAddress: Address,
  maxFee: bigint
): BurnIntentData {
  return {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1,
      sourceDomain: DOMAIN_IDS[sourceChain],
      destinationDomain: DOMAIN_IDS[destinationChain],
      sourceContract: GATEWAY_WALLET_ADDRESS,
      destinationContract: GATEWAY_MINTER_ADDRESS,
      sourceToken: USDC_ADDRESSES[sourceChain],
      destinationToken: USDC_ADDRESSES[destinationChain],
      sourceDepositor: depositorAddress, // The wallet that deposited (has the balance)
      destinationRecipient: recipientAddress,
      sourceSigner: signerAddress, // EOA signs the burn intent
      destinationCaller: zeroAddress,
      value: amount,
      salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
      hookData: "0x" as `0x${string}`,
    },
  };
}

interface GatewayEstimateItem {
  burnIntent?: { maxFee?: string };
}

/**
 * Asks Gateway for the fee a burn intent needs (`maxFee`). The fee is taken from the source
 * chain's Gateway balance on top of the transferred amount.
 */
export async function estimateBurnIntentFee(burnIntent: BurnIntentData): Promise<bigint> {
  const { spec } = burnIntentTypedData(burnIntent).message;
  const response = await fetch(`${GATEWAY_API_URL}/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ spec: { ...spec, value: spec.value.toString() } }]),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  // The testnet API answers with the list of estimated burn intents.
  const data: unknown = await response.json();
  const items = (Array.isArray(data) ? data : (data as { body?: unknown })?.body) as
    | GatewayEstimateItem[]
    | undefined;
  const maxFee = items?.[0]?.burnIntent?.maxFee;
  if (typeof maxFee !== "string" || !/^\d+$/.test(maxFee)) {
    throw new Error("Gateway API error: fee estimate has no maxFee");
  }
  return BigInt(maxFee);
}

/** The depositor's Gateway balance on one chain, in USDC base units. */
export async function getGatewayAvailableBalance(
  depositorAddress: Address,
  chain: SupportedChain
): Promise<bigint> {
  const { balances } = await fetchGatewayBalance(depositorAddress);
  const entry = balances.find((b) => b.domain === DOMAIN_IDS[chain]);
  return entry ? parseUnits(entry.balance, 6) : BigInt(0);
}

/**
 * Works out the fee for a transfer and checks the source chain's Gateway balance covers
 * amount + fee. Used for the dashboard's fee preview and before signing a burn intent.
 */
export async function quoteGatewayTransfer(
  userId: string,
  amount: bigint,
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress: Address,
  depositorAddress: Address
): Promise<{ fee: bigint; available: bigint; required: bigint; signerAddress: Address }> {
  const { address } = await getSignerWalletIdForUser(userId);
  const signerAddress = address as Address;
  const [fee, available] = await Promise.all([
    estimateBurnIntentFee(
      buildBurnIntent(amount, sourceChain, destinationChain, recipientAddress, depositorAddress, signerAddress, BigInt(0))
    ),
    getGatewayAvailableBalance(depositorAddress, sourceChain),
  ]);
  return { fee, available, required: amount + fee, signerAddress };
}

/**
 * Transfer Gateway balance using EOA wallet signing (no Circle wallet needed)
 * @param depositorAddress - The address that deposited to Gateway (has the balance)
 */
export async function transferGatewayBalanceWithEOA(
  userId: string,
  amount: bigint,
  sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress: Address,
  depositorAddress: Address
): Promise<{
  transferId: string;
  attestation: `0x${string}`;
  attestationSignature: `0x${string}`;
}> {
  // 1. Fee and balance check. Gateway burns amount + fee from the source chain's balance,
  //    so a transfer of the whole balance can't succeed.
  const { fee, available, required, signerAddress } = await quoteGatewayTransfer(
    userId,
    amount,
    sourceChain,
    destinationChain,
    recipientAddress,
    depositorAddress
  );
  if (available < required) {
    throw new InsufficientGatewayBalanceError(sourceChain, required, available, fee);
  }

  console.log(`Transferring ${formatUnits(amount, 6)} USDC from Gateway (fee up to ${formatUnits(fee, 6)})`);
  console.log(`  Depositor (has balance): ${depositorAddress}`);
  console.log(`  Signer (signs burn): ${signerAddress}`);

  // 2. Construct the burn intent with the fee Gateway asked for
  const burnIntentData = buildBurnIntent(
    amount,
    sourceChain,
    destinationChain,
    recipientAddress,
    depositorAddress,
    signerAddress,
    fee
  );

  // 3. Sign Intent with EOA
  const signature = await signBurnIntentWithEOA(burnIntentData, userId);

  // 4. Submit to Gateway
  const typedData = burnIntentTypedData(burnIntentData);

  const { attestation, attestationSignature, transferId } = await submitBurnIntent(
    typedData.message,
    signature
  );

  console.log(`Gateway transfer submitted. ID: ${transferId}`);

  // 5. Poll for attestation if not immediately available
  let finalAttestation = attestation;
  let finalSignature = attestationSignature;

  if (!finalAttestation || !finalSignature) {
    console.log(`Polling for attestation...`);
    
    let attempts = 0;
    const maxAttempts = 60; // 3 minutes max
    
    while (attempts < maxAttempts) {
      await sleep(3000);

      const pollResponse = await fetch(`${GATEWAY_API_URL}/transfers/${transferId}`);
      const pollJson = await pollResponse.json();
      const status = pollJson.status || pollJson.state;

      console.log(`Transfer Status: ${status} (attempt ${attempts + 1}/${maxAttempts})`);

      if (pollJson.attestation && pollJson.signature) {
        finalAttestation = pollJson.attestation;
        finalSignature = pollJson.signature;
        console.log(`Attestation received!`);
        break;
      } else if (status === "FAILED") {
        throw new Error(`Transfer failed: ${JSON.stringify(pollJson)}`);
      }
      
      attempts++;
    }
    
    if (!finalAttestation || !finalSignature) {
      throw new Error(`Attestation not received after ${maxAttempts} attempts. Transfer ID: ${transferId}`);
    }
  }

  return {
    transferId,
    attestation: finalAttestation as `0x${string}`,
    attestationSignature: finalSignature as `0x${string}`,
  };
}

export async function fetchGatewayBalance(address: Address): Promise<{
  token: string;
  balances: Array<{ domain: number; depositor: string; balance: string }>;
}> {
  const sources = [
    { domain: DOMAIN_IDS.arcTestnet, depositor: address },
    { domain: DOMAIN_IDS.avalancheFuji, depositor: address },
    { domain: DOMAIN_IDS.baseSepolia, depositor: address },
  ];

  const requestBody = {
    token: "USDC",
    sources,
  };

  const response = await fetch(`${GATEWAY_API_URL}/balances`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data;
}

export async function getUsdcBalance(
  address: Address,
  chain: SupportedChain
): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: getChainConfig(chain),
    transport: http(),
  });

  const balance = await publicClient.readContract({
    address: USDC_ADDRESSES[chain] as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });

  return balance as bigint;
}

export async function fetchGatewayInfo(): Promise<{
  version: number;
  domains: Array<{
    chain: string;
    network: string;
    domain: number;
    walletContract: { address: string; supportedTokens: string[] };
    minterContract: { address: string; supportedTokens: string[] };
    processedHeight: string;
    burnIntentExpirationHeight: string;
  }>;
}> {
  const response = await fetch(`${GATEWAY_API_URL}/info`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gateway API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data;
}