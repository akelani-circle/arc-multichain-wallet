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
  transferGatewayBalanceWithEOA,
  executeMintCircle,
  checkWalletGasBalance,
  InsufficientGatewayBalanceError,
  type SupportedChain,
  CIRCLE_CHAIN_NAMES,
} from "@/lib/circle/gateway-sdk";
import { getGatewayEOAWalletId } from "@/lib/circle/create-gateway-eoa-wallets";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseUsdcAmount } from "@/lib/usdc";
import { toUserFacingError } from "@/lib/errors";
import { isAddress, zeroAddress, type Address } from "viem";
import { Transaction } from "@circle-fin/developer-controlled-wallets";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sourceChain, destinationChain, amount, recipientAddress } =
    await req.json().catch(() => ({}));

  try {
    if (!sourceChain || !destinationChain || !amount) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: sourceChain, destinationChain, amount",
        },
        { status: 400 }
      );
    }

    // Validate chains
    const validChains: SupportedChain[] = [
      "baseSepolia",
      "avalancheFuji",
      "arcTestnet"
    ];
    if (
      !validChains.includes(sourceChain) ||
      !validChains.includes(destinationChain)
    ) {
      return NextResponse.json(
        { error: `Invalid chain. Must be one of: ${validChains.join(", ")}` },
        { status: 400 }
      );
    }

    // Same-chain transfers are allowed (withdrawal from Gateway to wallet)
    // Cross-chain transfers will go through Gateway's burn/mint process

    // Exact base units. parseFloat let NaN and "12abc" through and drifted on decimals.
    const parsed = parseUsdcAmount(amount);
    if (!parsed) {
      return NextResponse.json(
        { error: "Amount must be a positive USDC amount with at most 6 decimal places" },
        { status: 400 }
      );
    }
    const amountInAtomicUnits = parsed.atomic;

    // The recipient receives real funds on a burn/mint that cannot be undone, so a
    // malformed or zero address must be refused before anything is burned.
    if (
      recipientAddress !== undefined &&
      recipientAddress !== null &&
      recipientAddress !== "" &&
      (typeof recipientAddress !== "string" ||
        !isAddress(recipientAddress, { strict: false }) ||
        recipientAddress.toLowerCase() === zeroAddress)
    ) {
      return NextResponse.json(
        { error: "recipientAddress must be a valid, non-zero address" },
        { status: 400 }
      );
    }

    // Get the user's multichain SCA wallet
    const { data: wallets, error: walletError } = await supabase
      .from("wallets")
      .select("circle_wallet_id, address")
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

    if (!wallets || wallets.length === 0 || !wallets[0]?.circle_wallet_id) {
      console.log(`No SCA wallet found for user ${user.id}`);
      return NextResponse.json(
        { error: "No Circle wallet found. Please ensure wallet is created during signup." },
        { status: 404 }
      );
    }

    const wallet = wallets[0];
    const walletAddress = wallet.address as Address;
    const recipient = recipientAddress || walletAddress;

    // Determine if we're using external recipient
    const isExternalRecipient =
      !!recipientAddress && recipientAddress.toLowerCase() !== walletAddress.toLowerCase();

    // The wallet that calls gatewayMint on the destination chain. For the user's own wallet
    // it is the SCA, whose gas Circle Gas Station pays, so it needs no native tokens. For an
    // external recipient it is the user's EOA, which pays its own gas.
    let minterAddress = walletAddress;
    if (isExternalRecipient) {
      const { address: eoaAddress } = await getGatewayEOAWalletId(user.id);
      minterAddress = eoaAddress as Address;

      // PRE-FLIGHT CHECK: Verify the EOA has gas on the destination chain BEFORE burning
      try {
        const gasCheck = await checkWalletGasBalance(minterAddress, destinationChain as SupportedChain);

        if (!gasCheck.hasGas) {
          return NextResponse.json(
            {
              error: "INSUFFICIENT_GAS",
              walletAddress: gasCheck.address,
              blockchain: CIRCLE_CHAIN_NAMES[destinationChain as SupportedChain],
              chain: destinationChain,
              message: `Insufficient gas: The wallet that will execute the mint transaction has no native tokens on ${destinationChain}.`,
            },
            { status: 400 }
          );
        }

        console.log(`Gas check passed for ${gasCheck.address} on ${destinationChain} (balance: ${gasCheck.balance})`);
      } catch (gasCheckError: unknown) {
        console.error("Gas pre-flight check failed:", gasCheckError);
        // Continue anyway - the actual mint will catch this if it's a real issue
      }
    }

    // Use EOA-signed burn/mint process for all transfers (same-chain and cross-chain).
    // Refuses before signing if the source chain's Gateway balance can't cover amount + fee.
    const { attestation, attestationSignature } = await transferGatewayBalanceWithEOA(
      user.id,
      amountInAtomicUnits,
      sourceChain as SupportedChain,
      destinationChain as SupportedChain,
      recipient as Address,
      walletAddress
    );

    // Execute mint on destination chain
    const mintTx: Transaction = await executeMintCircle(
      minterAddress,
      destinationChain as SupportedChain,
      attestation,
      attestationSignature
    );

    const attestationHash = attestation;
    const mintTxHash = mintTx.txHash;

    // Store transaction in database. History is written by the server only.
    await createAdminClient().from("transaction_history").insert([
      {
        user_id: user.id,
        chain: sourceChain,
        tx_type: "transfer",
        amount: parsed.value,
        tx_hash: mintTxHash,
        gateway_wallet_address: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        destination_chain: destinationChain,
        status: "success",
        created_at: new Date().toISOString(),
      },
    ]);

    return NextResponse.json({
      success: true,
      attestation: attestationHash,
      mintTxHash,
      sourceChain,
      destinationChain,
      amount: parsed.value,
      recipient,
    });
  } catch (error: unknown) {
    console.error("Error in transfer:", error);

    // Refused before anything was signed or burned: nothing to record.
    if (error instanceof InsufficientGatewayBalanceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const errorMessage = error instanceof Error ? error.message : "";

    // Log failed transaction to database
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const failedAmount = parseUsdcAmount(amount);

      if (user && failedAmount) {
        await createAdminClient().from("transaction_history").insert([
          {
            user_id: user.id,
            chain: sourceChain,
            tx_type: "transfer",
            amount: failedAmount.value,
            destination_chain: destinationChain,
            status: "failed",
            reason: errorMessage || "Unknown error",
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (dbError) {
      console.error("Error logging failed transaction:", dbError);
    }

    // Check if this is an insufficient gas error
    if (errorMessage.startsWith("INSUFFICIENT_GAS:")) {
      const [, walletAddress, blockchain] = errorMessage.split(":");
      return NextResponse.json(
        {
          error: "INSUFFICIENT_GAS",
          walletAddress,
          blockchain,
          chain: destinationChain,
        },
        { status: 400 }
      );
    }

    const { message, status } = toUserFacingError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
