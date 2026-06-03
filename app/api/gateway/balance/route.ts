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

import { NextRequest, NextResponse } from "next/server";
import {
  fetchGatewayBalances,
  getUsdcBalance,
  type GatewayBalanceEntry,
  type SupportedChain,
} from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";
import type { Address } from "viem";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { addresses } = await req.json();

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid addresses array" },
        { status: 400 }
      );
    }

    const supportedChains: SupportedChain[] = [
      "arcTestnet",
      "baseSepolia",
      "avalancheFuji",
    ];

    // Fetch Gateway balances for all addresses in one batched App Kit call
    let gatewayByAddress = new Map<string, GatewayBalanceEntry>();
    try {
      const gatewayEntries = await fetchGatewayBalances(addresses as Address[]);
      for (const entry of gatewayEntries) {
        gatewayByAddress.set(entry.address.toLowerCase(), entry);
      }
    } catch (error: any) {
      console.error("Error fetching Gateway balances:", error.message);
      console.log("Will fetch on-chain balances only");
    }

    // Fetch on-chain USDC balances per address and merge with Gateway balances
    const balancePromises = addresses.map(async (address: string) => {
      try {
        const gateway = gatewayByAddress.get(address.toLowerCase());
        const gatewayBalances = gateway?.gatewayBalances ?? [];
        const gatewayTotal = gateway?.gatewayTotal ?? 0;

        const chainBalances = await Promise.all(
          supportedChains.map(async (chain) => {
            try {
              const balance = await getUsdcBalance(address as Address, chain);
              return {
                chain,
                balance: Number(balance) / 1_000_000,
                address,
              };
            } catch (error) {
              console.error(`Error fetching on-chain balance for ${chain}:`, error);
              return { chain, balance: 0, address };
            }
          })
        );

        const walletTotal = chainBalances.reduce((sum, cb) => sum + cb.balance, 0);

        return {
          address,
          gatewayBalances,
          gatewayTotal,
          chainBalances,
          walletTotal,
          totalBalance: gatewayTotal + walletTotal,
        };
      } catch (error: any) {
        console.error(`Error fetching balance for ${address}:`, error);
        return { address, error: error.message, totalBalance: 0 };
      }
    });

    const balances = await Promise.all(balancePromises);

    const totalUnified = balances.reduce((sum, b) => sum + (b.totalBalance || 0), 0);

    return NextResponse.json({ success: true, totalUnified, balances });
  } catch (error: any) {
    console.error("Error fetching balances:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
