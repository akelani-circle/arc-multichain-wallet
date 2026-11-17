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

/**
 * Creates EOA (Externally Owned Account) wallets for Gateway signing across all chains using Circle Wallets SDK
 * The same wallet ID will be used across all EVM chains (since Circle wallets derive to same address)
 * These wallets will be used to sign Gateway burn intents and must deposit funds to Gateway
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { circleDeveloperSdk } from "@/lib/circle/sdk";
import { idempotencyKeyFor, withIdempotentRetry } from "@/lib/circle/idempotency";

export interface GatewayEOAWallet {
  chain: string;
  address: string;
  walletId: string;
  name: string;
}

/**
 * Create a single multichain EOA wallet using Circle Wallets SDK
 * Creates one EOA wallet that works across all EVM chains
 * Circle SDK automatically derives the same address across all chains
 */
export async function generateGatewayEOAWallet(
  walletSetId: string,
  userId: string
): Promise<GatewayEOAWallet> {
  // Create EOA wallet on ALL supported chains so Circle SDK recognizes it everywhere.
  // One idempotency key per user: concurrent requests (the dashboard and sign-up both ask
  // for it) get the same wallet back instead of each creating one.
  const response = await withIdempotentRetry(() =>
    circleDeveloperSdk.createWallets({
      walletSetId,
      accountType: "EOA",
      blockchains: ["ARC-TESTNET", "BASE-SEPOLIA", "AVAX-FUJI"],
      count: 1,
      idempotencyKey: idempotencyKeyFor(userId, "gateway_signer"),
    })
  );

  if (!response.data?.wallets || response.data.wallets.length === 0) {
    throw new Error("Failed to create Gateway EOA wallet via Circle SDK");
  }

  const wallet = response.data.wallets[0];
  console.log(`Created Gateway EOA wallet ${wallet.address} via Circle SDK`);

  return {
    chain: wallet.blockchain,
    address: wallet.address,
    walletId: wallet.id,
    name: wallet.name || "Gateway Signer (Multichain)",
  };
}

/**
 * Create the Gateway EOA wallet for a user and store it.
 * Creates one multichain EOA wallet that can sign for all chains. If a concurrent request
 * stored it first, returns that row.
 */
export async function storeGatewayEOAWalletForUser(userId: string, walletSetId: string) {
  // Wallet rows are written only by the server (see migration 20260919120000).
  const supabase = createAdminClient();

  // Create one EOA wallet in the wallet set
  const wallet = await generateGatewayEOAWallet(walletSetId, userId);

  // Store wallet information in database - one record for the multichain wallet
  const insertData = {
    user_id: userId,
    name: wallet.name,
    address: wallet.address,
    wallet_address: wallet.address, // For compatibility with existing schema
    blockchain: "MULTICHAIN", // Indicates it works across all chains
    type: "gateway_signer",
    circle_wallet_id: wallet.walletId,
    wallet_set_id: walletSetId,
  };

  const { data, error } = await supabase
    .from("wallets")
    .insert([insertData])
    .select();

  if (error) {
    // 23505: a concurrent request for the same user stored the signer first.
    if (error.code === "23505") {
      const { data: existing, error: readError } = await supabase
        .from("wallets")
        .select()
        .eq("user_id", userId)
        .eq("type", "gateway_signer");
      if (!readError && existing && existing.length > 0) return existing;
    }
    console.error("Error storing Gateway EOA wallet:", error);
    throw error;
  }

  console.log(
    `Stored Gateway EOA wallet for user ${userId} with address ${wallet.address}`
  );
  return data;
}

/**
 * Get the Gateway EOA wallet for a user. It is one multichain row (blockchain = "MULTICHAIN");
 * its address is the same on every chain. The ID is that of its Arc wallet, which is enough
 * for signing (burn intents are not chain-specific); transactions select it by address.
 */
export async function getGatewayEOAWalletId(
  userId: string
): Promise<{ walletId: string; address: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wallets")
    .select("circle_wallet_id, address")
    .eq("user_id", userId)
    .eq("type", "gateway_signer")
    .single();

  if (error || !data) {
    throw new Error(`Gateway EOA wallet not found for user ${userId}`);
  }

  return {
    walletId: data.circle_wallet_id,
    address: data.address,
  };
}

/**
 * Get or create Gateway EOA wallet for a user
 * If wallet doesn't exist, creates it for the user using their SCA wallet set
 */
export async function getOrCreateGatewayEOAWallet(
  userId: string
): Promise<{ walletId: string; address: string }> {
  try {
    // Try to get existing wallet
    return await getGatewayEOAWalletId(userId);
  } catch {
    // Wallet doesn't exist, create it using the user's existing wallet set
    console.log(`Creating Gateway EOA wallet for user ${userId}`);
    
    const supabase = await createClient();
    
    // Get the user's existing wallet_set_id from their SCA wallets
    const { data: scaWallet, error: scaError } = await supabase
      .from("wallets")
      .select("wallet_set_id")
      .eq("user_id", userId)
      .eq("type", "sca")
      .limit(1)
      .single();
    
    if (scaError || !scaWallet) {
      throw new Error(`No SCA wallet found for user ${userId}. Cannot create EOA wallet.`);
    }
    
    await storeGatewayEOAWalletForUser(userId, scaWallet.wallet_set_id);
    
    // Now get the newly created wallet
    return await getGatewayEOAWalletId(userId);
  }
}
