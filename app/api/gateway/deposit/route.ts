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
  initiateDepositFromCustodialWallet,
  type SupportedChain,
} from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUsdcAmount } from "@/lib/usdc";
import { toUserFacingError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  let requestBody: any = {};
  
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    requestBody = await req.json().catch(() => ({}));
    const { chain, amount } = requestBody;

    if (!chain || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: chain, amount" },
        { status: 400 }
      );
    }

    // Validate chain
    const validChains: SupportedChain[] = ["arcTestnet", "baseSepolia", "avalancheFuji"];
    if (!validChains.includes(chain)) {
      return NextResponse.json(
        { error: `Invalid chain. Must be one of: ${validChains.join(", ")}` },
        { status: 400 }
      );
    }

    // Exact base units. parseFloat let NaN and "12abc" through and drifted on decimals.
    const parsed = parseUsdcAmount(amount);
    if (!parsed) {
      return NextResponse.json(
        { error: "Amount must be a positive USDC amount with at most 6 decimal places" },
        { status: 400 }
      );
    }
    const amountInAtomicUnits = parsed.atomic;

    // Get the user's multichain SCA wallet
    const { data: wallets, error: walletError } = await supabase
      .from("wallets")
      .select("circle_wallet_id, wallet_set_id, address")
      .eq("user_id", user.id)
      .eq("type", "sca")
      .limit(1);

    if (walletError) {
      console.error("Database error fetching wallets:", walletError);
      return NextResponse.json(
        { error: "Database error when fetching wallets." },
        { status: 500 }
      );
    }

    if (!wallets || wallets.length === 0) {
      console.log(`No SCA wallet found for user ${user.id}`);
      return NextResponse.json(
        { error: "No Circle wallet found. Please ensure wallet is created during signup." },
        { status: 404 }
      );
    }

    const wallet = wallets[0];

    // Get or create EOA signer wallet (multichain)
    const { getOrCreateGatewayEOAWallet } = await import("@/lib/circle/create-gateway-eoa-wallets");
    const { address: eoaAddress } = await getOrCreateGatewayEOAWallet(user.id, chain);

    // Deposit to Gateway and add EOA as delegate (allows EOA to sign burn intents)
    const txHash = await initiateDepositFromCustodialWallet(
      wallet.circle_wallet_id,
      chain as SupportedChain,
      amountInAtomicUnits,
      eoaAddress as `0x${string}`
    );

    // Store transaction in database. History is written by the server only.
    await createAdminClient().from("transaction_history").insert([
      {
        user_id: user.id,
        chain,
        tx_type: "deposit",
        amount: parsed.value,
        tx_hash: txHash,
        // This should probably be dynamic if you support multiple gateways
        gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        status: "success",
        created_at: new Date().toISOString(),
      },
    ]);

    return NextResponse.json({
      success: true,
      txHash,
      chain,
      amount: parsed.value,
    });
  } catch (error: any) {
    console.error("Error in deposit:", error);

    // Log failed transaction to database
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const failedAmount = parseUsdcAmount(requestBody.amount);

      if (user && requestBody.chain && failedAmount) {
        await createAdminClient().from("transaction_history").insert([
          {
            user_id: user.id,
            chain: requestBody.chain,
            tx_type: "deposit",
            amount: failedAmount.value,
            status: "failed",
            reason: error.message || "Unknown error",
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (dbError) {
      console.error("Error logging failed transaction:", dbError);
    }

    const { message, status } = toUserFacingError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
