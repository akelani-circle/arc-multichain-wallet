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

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CIRCLE_CHAIN_NAMES, type SupportedChain } from "@/lib/circle/gateway-sdk";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { getGatewayEOAWalletId } = await import("@/lib/circle/create-gateway-eoa-wallets");

    // One multichain EOA: the same wallet and address on every chain.
    let signer: { walletId: string; address: string } | null = null;
    try {
      signer = await getGatewayEOAWalletId(user.id);
    } catch (error) {
      console.error("Error fetching EOA wallet:", error);
    }

    const chains: SupportedChain[] = ["baseSepolia", "avalancheFuji", "arcTestnet"];
    return NextResponse.json({
      wallets: signer
        ? chains.map((chain) => ({ chain, blockchain: CIRCLE_CHAIN_NAMES[chain], ...signer }))
        : [],
    });
  } catch (error: unknown) {
    console.error("Error fetching EOA wallets:", error);
    return NextResponse.json({ error: "Failed to fetch EOA wallets" }, { status: 500 });
  }
}
