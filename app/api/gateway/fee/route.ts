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
import { formatUnits, type Address } from "viem";
import { quoteGatewayTransfer, type SupportedChain } from "@/lib/circle/gateway-sdk";
import { createClient } from "@/lib/supabase/server";
import { parseUsdcAmount } from "@/lib/usdc";
import { toUserFacingError } from "@/lib/errors";

const VALID_CHAINS: SupportedChain[] = ["arcTestnet", "baseSepolia", "avalancheFuji"];

/**
 * Quotes a Gateway transfer from the caller's wallet: the fee Gateway will take on top of the
 * amount, and the Gateway balance available on the source chain. Signs and moves nothing.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sourceChain, destinationChain, amount } = await req.json().catch(() => ({}));

  if (!VALID_CHAINS.includes(sourceChain) || !VALID_CHAINS.includes(destinationChain)) {
    return NextResponse.json(
      { error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(", ")}` },
      { status: 400 }
    );
  }
  const parsed = parseUsdcAmount(amount);
  if (!parsed) {
    return NextResponse.json(
      { error: "Amount must be a positive USDC amount with at most 6 decimal places" },
      { status: 400 }
    );
  }

  const { data: wallets, error: walletError } = await supabase
    .from("wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("type", "sca")
    .limit(1);

  if (walletError) {
    console.error("Database error fetching wallets:", walletError);
    return NextResponse.json({ error: "Database error when fetching wallets." }, { status: 500 });
  }
  if (!wallets || wallets.length === 0) {
    return NextResponse.json({ error: "No Circle wallet found." }, { status: 404 });
  }

  try {
    const walletAddress = wallets[0].address as Address;
    const { fee, available, required } = await quoteGatewayTransfer(
      user.id,
      parsed.atomic,
      sourceChain,
      destinationChain,
      walletAddress,
      walletAddress
    );
    return NextResponse.json({
      fee: formatUnits(fee, 6),
      available: formatUnits(available, 6),
      required: formatUnits(required, 6),
      sufficient: available >= required,
    });
  } catch (error: unknown) {
    console.error("Error quoting transfer fee:", error);
    const { message, status } = toUserFacingError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
