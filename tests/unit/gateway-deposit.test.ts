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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { queryBuilder, queueTables } from "../helpers/supabase-mock";
import { SCA_WALLET, USER, signedIn, signedOut, withWallet, type UserClient } from "../helpers/scenario";

const user = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }));
const admin = vi.hoisted(() => ({ from: vi.fn() }));
const gateway = vi.hoisted(() => ({ initiateDepositFromCustodialWallet: vi.fn() }));
const eoa = vi.hoisted(() => ({ getOrCreateGatewayEOAWallet: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/circle/gateway-sdk", () => gateway);
vi.mock("@/lib/circle/create-gateway-eoa-wallets", () => eoa);

import { POST } from "@/app/api/gateway/deposit/route";

const post = (body: unknown, raw = false) =>
  POST(
    new NextRequest("http://localhost/api/gateway/deposit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );

beforeEach(() => {
  user.from.mockReset();
  user.auth.getUser.mockReset();
  admin.from.mockReset();
  gateway.initiateDepositFromCustodialWallet.mockReset();
  eoa.getOrCreateGatewayEOAWallet.mockReset();
  eoa.getOrCreateGatewayEOAWallet.mockResolvedValue({ address: "0x" + "e0".repeat(20), walletId: "cw-eoa" });
  gateway.initiateDepositFromCustodialWallet.mockResolvedValue("0xdeposittx");
});

describe("POST /api/gateway/deposit", () => {
  it("refuses a signed-out caller", async () => {
    signedOut(user as UserClient);
    expect((await post({ chain: "arcTestnet", amount: "1" })).status).toBe(401);
    expect(gateway.initiateDepositFromCustodialWallet).not.toHaveBeenCalled();
  });

  it("rejects a missing body and an unknown chain", async () => {
    signedIn(user as UserClient, withWallet());
    expect((await post("nope", true)).status).toBe(400);
    signedIn(user as UserClient, withWallet());
    expect((await post({ chain: "ethereum", amount: "1" })).status).toBe(400);
    expect(gateway.initiateDepositFromCustodialWallet).not.toHaveBeenCalled();
  });

  it.each(["abc", "12abc", "-5", "0", "1e400", "NaN", "Infinity", "1.1234567", "", "  "])(
    "rejects amount %j before touching a wallet (parseFloat let several of these through)",
    async (amount) => {
      signedIn(user as UserClient, withWallet());
      const res = await post({ chain: "arcTestnet", amount });
      expect(res.status).toBe(400);
      expect(gateway.initiateDepositFromCustodialWallet).not.toHaveBeenCalled();
    }
  );

  it("answers 404 when the user has no wallet", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [] })] });
    expect((await post({ chain: "arcTestnet", amount: "1" })).status).toBe(404);
    expect(gateway.initiateDepositFromCustodialWallet).not.toHaveBeenCalled();
  });

  it("deposits the exact base units from the caller's own wallet", async () => {
    signedIn(user as UserClient, withWallet());
    const history = queryBuilder({});
    queueTables(admin, { transaction_history: [history] });

    const res = await post({ chain: "baseSepolia", amount: "0.29" });

    expect(res.status).toBe(200);
    expect(gateway.initiateDepositFromCustodialWallet).toHaveBeenCalledWith(
      SCA_WALLET.circle_wallet_id,
      "baseSepolia",
      BigInt(290_000), // Math.floor(0.29 * 1e6) is 289999
      "0x" + "e0".repeat(20)
    );
    expect(history.insert.mock.calls[0][0][0]).toMatchObject({
      user_id: USER.id,
      tx_type: "deposit",
      tx_hash: "0xdeposittx",
      amount: 0.29,
      status: "success",
    });
  });

  it("records history with the secret-key client, never the user's", async () => {
    signedIn(user as UserClient, withWallet());
    queueTables(admin, { transaction_history: [queryBuilder({})] });
    await post({ chain: "arcTestnet", amount: "1" });
    expect(user.from).not.toHaveBeenCalledWith("transaction_history");
    expect(admin.from).toHaveBeenCalledWith("transaction_history");
  });

  it("does not leak the text of an unexpected error to the caller", async () => {
    signedIn(user as UserClient, withWallet());
    // failure path: getUser is called again to log the failed attempt
    queueTables(admin, { transaction_history: [queryBuilder({})] });
    gateway.initiateDepositFromCustodialWallet.mockRejectedValue(
      new Error("Circle request 8f3a failed for entity 1234 with key TEST_API_KEY:abc")
    );

    const res = await post({ chain: "arcTestnet", amount: "1" });

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("TEST_API_KEY");
  });
});
