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

import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    "Integration tests need the local Supabase stack. Run `npm run db:start` and make sure .env.local has NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npm run db:status`)."
  );
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const PASSWORD = "correct-horse-battery";
const service = createClient(url, secretKey, options);
const anonymous = () => createClient(url, publishableKey, options);

interface Person {
  id: string;
  client: SupabaseClient;
}

const userIds: string[] = [];

async function person(): Promise<Person> {
  const email = `it-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userIds.push(data.user.id);
  const client = createClient(url!, publishableKey!, options);
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  return { id: data.user.id, client };
}

const walletRow = (userId: string, over: Record<string, unknown> = {}) => ({
  user_id: userId,
  circle_wallet_id: randomUUID(),
  wallet_set_id: randomUUID(),
  wallet_address: "0x" + "ab".repeat(20),
  address: "0x" + "ab".repeat(20),
  type: "sca",
  blockchain: "MULTICHAIN",
  ...over,
});

const historyRow = (userId: string, over: Record<string, unknown> = {}) => ({
  user_id: userId,
  chain: "arcTestnet",
  tx_type: "deposit",
  amount: 5,
  tx_hash: "0x" + "cd".repeat(32),
  status: "success",
  ...over,
});

let alice: Person;
let bob: Person;

beforeAll(async () => {
  [alice, bob] = await Promise.all([person(), person()]);
});

afterAll(async () => {
  await service.from("transaction_history").delete().in("user_id", userIds);
  await service.from("wallets").delete().in("user_id", userIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
});

const PERMISSION_DENIED = "42501";

describe("transaction_history (used to have no row level security at all)", () => {
  it("is not readable with the publishable key alone", async () => {
    await service.from("transaction_history").insert(historyRow(alice.id));
    const { data } = await anonymous().from("transaction_history").select("*");
    expect(data ?? []).toEqual([]);
  });

  it("lets a user read only their own history", async () => {
    await service.from("transaction_history").insert(historyRow(alice.id, { tx_hash: "0x" + "a1".repeat(32) }));
    await service.from("transaction_history").insert(historyRow(bob.id, { tx_hash: "0x" + "b2".repeat(32) }));

    const { data } = await alice.client.from("transaction_history").select("tx_hash, user_id");
    expect(data!.every((row) => row.user_id === alice.id)).toBe(true);
    expect(data!.map((row) => row.tx_hash)).toContain("0x" + "a1".repeat(32));
    expect(data!.map((row) => row.tx_hash)).not.toContain("0x" + "b2".repeat(32));
  });

  it("does not let a user, or anyone with the publishable key, forge history", async () => {
    const own = await alice.client.from("transaction_history").insert(historyRow(alice.id, { amount: 999999, tx_hash: "0x" + "ee".repeat(32) }));
    expect(own.error?.code).toBe(PERMISSION_DENIED);

    const forBob = await alice.client.from("transaction_history").insert(historyRow(bob.id));
    expect(forBob.error?.code).toBe(PERMISSION_DENIED);

    const anon = await anonymous().from("transaction_history").insert(historyRow(alice.id));
    expect(anon.error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let a user edit or delete history", async () => {
    const { data: inserted } = await service
      .from("transaction_history")
      .insert(historyRow(alice.id, { tx_hash: "0x" + "f1".repeat(32), amount: 5 }))
      .select("id")
      .single();

    const update = await alice.client.from("transaction_history").update({ amount: 0.01 }).eq("id", inserted!.id);
    const remove = await alice.client.from("transaction_history").delete().eq("id", inserted!.id);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);

    const { data } = await service.from("transaction_history").select("amount").eq("id", inserted!.id).single();
    expect(Number(data!.amount)).toBe(5);
  });

  it("rejects malformed rows even from the server", async () => {
    const badType = await service.from("transaction_history").insert(historyRow(alice.id, { tx_type: "drain" }));
    expect(badType.error?.code).toBe("23514");
    const badAmount = await service.from("transaction_history").insert(historyRow(alice.id, { amount: 0 }));
    expect(badAmount.error?.code).toBe("23514");
    const badUser = await service.from("transaction_history").insert(historyRow(randomUUID()));
    expect(badUser.error?.code).toBe("23503");
  });
});

describe("wallets", () => {
  it("lets a user read only their own wallets", async () => {
    await service.from("wallets").insert(walletRow(alice.id));
    await service.from("wallets").insert(walletRow(bob.id, { type: "gateway_signer" }));

    const { data } = await alice.client.from("wallets").select("user_id");
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row) => row.user_id === alice.id)).toBe(true);
    expect((await anonymous().from("wallets").select("*")).data ?? []).toEqual([]);
  });

  it("does not let a user insert a wallet row (the money routes trust it as 'my wallet')", async () => {
    const carol = await person();
    const { error } = await carol.client.from("wallets").insert(walletRow(carol.id));
    expect(error?.code).toBe(PERMISSION_DENIED);

    const { data } = await service.from("wallets").select("id").eq("user_id", carol.id);
    expect(data).toEqual([]);
  });

  it("does not let a user insert a wallet pointing at a Circle wallet id of their choosing", async () => {
    const carol = await person();
    const victimCircleWalletId = randomUUID(); // a wallet that is not in this table
    const { error } = await carol.client.from("wallets").insert(walletRow(carol.id, { circle_wallet_id: victimCircleWalletId }));
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let a user edit or delete their wallet rows", async () => {
    const update = await alice.client.from("wallets").update({ circle_wallet_id: randomUUID() }).eq("user_id", alice.id);
    const remove = await alice.client.from("wallets").delete().eq("user_id", alice.id);
    expect(update.error?.code).toBe(PERMISSION_DENIED);
    expect(remove.error?.code).toBe(PERMISSION_DENIED);
  });

  it("allows one SCA wallet and one gateway signer per user (concurrent sign-ups made two)", async () => {
    const carol = await person();
    expect((await service.from("wallets").insert(walletRow(carol.id, { type: "sca" }))).error).toBeNull();
    expect((await service.from("wallets").insert(walletRow(carol.id, { type: "gateway_signer" }))).error).toBeNull();
    expect((await service.from("wallets").insert(walletRow(carol.id, { type: "sca" }))).error?.code).toBe("23505");
    expect((await service.from("wallets").insert(walletRow(carol.id, { type: "gateway_signer" }))).error?.code).toBe("23505");
  });
});
