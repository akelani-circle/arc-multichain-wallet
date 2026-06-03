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

import {
  http,
  createPublicClient,
  erc20Abi,
  type Address,
  type Chain,
} from "viem";
import * as chains from "viem/chains";
import { AppKit, Blockchain, UnifiedBalanceChain } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";

export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

const arcRpcKey = process.env.ARC_TESTNET_RPC_KEY || 'c0ca2582063a5bbd5db2f98c139775e982b16919';

export const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [`https://rpc.testnet.arc.network/${arcRpcKey}`] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.arc.testnet.circle.com' },
  },
  testnet: true,
} as const satisfies Chain;

export const USDC_ADDRESSES = {
  arcTestnet: "0x3600000000000000000000000000000000000000",
  avalancheFuji: "0x5425890298aed601595a70ab815c96711a31bc65",
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

export const TOKEN_IDS = {
  arcTestnet: "15dc2b5d-0994-58b0-bf8c-3a0501148ee8",
  sepolia: "d2177333-b33a-5263-b699-2a6a52722214",
} as const;

export const DOMAIN_IDS = {
  avalancheFuji: 1,
  baseSepolia: 6,
  arcTestnet: 26,
} as const;

export type SupportedChain = keyof typeof USDC_ADDRESSES;

export const CIRCLE_CHAIN_NAMES: Record<SupportedChain, string> = {
  avalancheFuji: "AVAX-FUJI",
  baseSepolia: "BASE-SEPOLIA",
  arcTestnet: "ARC-TESTNET",
};

export const CHAIN_BY_DOMAIN: Record<number, SupportedChain> = {
  [DOMAIN_IDS.avalancheFuji]: "avalancheFuji",
  [DOMAIN_IDS.baseSepolia]: "baseSepolia",
  [DOMAIN_IDS.arcTestnet]: "arcTestnet",
} as const;

const APP_KIT_CHAIN_NAMES: Record<SupportedChain, UnifiedBalanceChain> = {
  arcTestnet: UnifiedBalanceChain.Arc_Testnet,
  baseSepolia: UnifiedBalanceChain.Base_Sepolia,
  avalancheFuji: UnifiedBalanceChain.Avalanche_Fuji,
};

const appKit = new AppKit();

function createAdapter() {
  return createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY!,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  });
}

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

export async function initiateDepositFromCustodialWallet(
  walletAddress: string,
  chain: SupportedChain,
  amount: string
): Promise<string> {
  const adapter = createAdapter();
  const result = await appKit.unifiedBalance.deposit({
    from: { adapter, chain: APP_KIT_CHAIN_NAMES[chain], address: walletAddress },
    amount,
    token: "USDC",
  });
  return result.txHash;
}

export async function transferUnifiedBalanceCircle(
  walletAddress: string,
  amount: string,
  _sourceChain: SupportedChain,
  destinationChain: SupportedChain,
  recipientAddress?: string
): Promise<{
  burnTxHash: string;
  attestation: string;
  mintTxHash: string;
}> {
  const adapter = createAdapter();
  const result = await appKit.unifiedBalance.spend({
    from: { adapter, address: walletAddress },
    to: {
      adapter,
      chain: APP_KIT_CHAIN_NAMES[destinationChain],
      address: walletAddress,
      recipientAddress: recipientAddress || walletAddress,
    },
    token: "USDC",
    amount,
  });
  return {
    burnTxHash: "0x",
    attestation: "0x",
    mintTxHash: result.txHash,
  };
}

const APP_KIT_TO_INTERNAL: Record<string, SupportedChain> = {
  [Blockchain.Arc_Testnet]: "arcTestnet",
  [Blockchain.Base_Sepolia]: "baseSepolia",
  [Blockchain.Avalanche_Fuji]: "avalancheFuji",
};

export type GatewayBalanceEntry = {
  address: string;
  gatewayTotal: number;
  gatewayBalances: Array<{ chain: string; balance: number; address: string }>;
};

export async function fetchGatewayBalances(addresses: Address[]): Promise<GatewayBalanceEntry[]> {
  const result = await appKit.unifiedBalance.getBalances({
    token: "USDC",
    sources: addresses.map((address) => ({
      address,
      chains: [
        UnifiedBalanceChain.Arc_Testnet,
        UnifiedBalanceChain.Base_Sepolia,
        UnifiedBalanceChain.Avalanche_Fuji,
      ],
    })),
    networkType: "testnet",
    includePending: true,
  });

  return result.breakdown.map((entry) => ({
    address: entry.depositor,
    gatewayTotal: parseFloat(entry.totalConfirmed),
    gatewayBalances: entry.breakdown.map((chainBalance) => ({
      chain: APP_KIT_TO_INTERNAL[chainBalance.chain] ?? String(chainBalance.chain),
      balance: parseFloat(chainBalance.confirmedBalance),
      address: entry.depositor,
    })),
  }));
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
  const response = await fetch("https://gateway-api-testnet.circle.com/v1/info", {
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
