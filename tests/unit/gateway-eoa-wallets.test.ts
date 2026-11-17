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
import { queryBuilder, queueTables } from "../helpers/supabase-mock";

const admin = vi.hoisted(() => ({ from: vi.fn() }));
const circle = vi.hoisted(() => ({ createWallets: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: vi.fn() }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/circle/sdk", () => ({ circleDeveloperSdk: circle }));

import { storeGatewayEOAWalletForUser } from "@/lib/circle/create-gateway-eoa-wallets";
import { idempotencyKeyFor } from "@/lib/circle/idempotency";

const WALLET = { id: "cw-eoa", address: "0x" + "e0".repeat(20), blockchain: "ARC-TESTNET" };

beforeEach(() => {
  admin.from.mockReset();
  circle.createWallets.mockReset();
  circle.createWallets.mockResolvedValue({ data: { wallets: [WALLET] } });
});

describe("idempotencyKeyFor", () => {
  it("is a stable UUID per input", () => {
    const key = idempotencyKeyFor("user-1", "gateway_signer");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotencyKeyFor("user-1", "gateway_signer")).toBe(key);
    expect(idempotencyKeyFor("user-2", "gateway_signer")).not.toBe(key);
  });
});

describe("storeGatewayEOAWalletForUser", () => {
  it("asks Circle with one fixed idempotency key per user, so repeats get the same wallet", async () => {
    queueTables(admin, { wallets: [queryBuilder({ data: [{ id: 1 }] }), queryBuilder({ data: [{ id: 1 }] })] });

    await storeGatewayEOAWalletForUser("user-1", "ws-1");
    await storeGatewayEOAWalletForUser("user-1", "ws-1");

    const keys = circle.createWallets.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys[0]).toBe(idempotencyKeyFor("user-1", "gateway_signer"));
    expect(keys[1]).toBe(keys[0]);
  });

  it("returns the stored row when a concurrent request inserted it first (23505)", async () => {
    const existing = [{ user_id: "user-1", type: "gateway_signer", circle_wallet_id: WALLET.id }];
    queueTables(admin, {
      wallets: [
        queryBuilder({ error: { message: "duplicate key", code: "23505" } }),
        queryBuilder({ data: existing }),
      ],
    });

    await expect(storeGatewayEOAWalletForUser("user-1", "ws-1")).resolves.toEqual(existing);
  });

  it("still throws other database errors", async () => {
    queueTables(admin, { wallets: [queryBuilder({ error: { message: "boom", code: "42501" } })] });
    await expect(storeGatewayEOAWalletForUser("user-1", "ws-1")).rejects.toMatchObject({ code: "42501" });
  });
});
