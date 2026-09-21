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
import { USER, signedIn, signedOut, type UserClient } from "../helpers/scenario";

const user = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }));
const admin = vi.hoisted(() => ({ from: vi.fn() }));
const circle = vi.hoisted(() => ({ createWalletSet: vi.fn(), createWallets: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/circle/sdk", () => ({ circleDeveloperSdk: circle }));

import * as route from "@/app/api/wallet-set/route";

const post = () => route.POST(new Request("http://localhost/api/wallet-set", { method: "POST" }) as never);

beforeEach(() => {
  user.from.mockReset();
  user.auth.getUser.mockReset();
  admin.from.mockReset();
  circle.createWalletSet.mockReset();
  circle.createWallets.mockReset();
  circle.createWalletSet.mockResolvedValue({ data: { walletSet: { id: "ws-1" } } });
  circle.createWallets.mockResolvedValue({ data: { wallets: [{ id: "cw-1", address: "0xabc" }] } });
});

describe("/api/wallet-set", () => {
  it("has no unauthenticated PUT any more (it created wallet sets for anyone)", () => {
    expect((route as Record<string, unknown>).PUT).toBeUndefined();
  });

  it("refuses a signed-out caller without calling Circle", async () => {
    signedOut(user as UserClient);
    expect((await post()).status).toBe(401);
    expect(circle.createWalletSet).not.toHaveBeenCalled();
  });

  it("does nothing if the user already has a wallet", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [{ wallet_set_id: "ws-old" }] })] });
    const res = await post();
    expect((await res.json()).message).toMatch(/already exists/);
    expect(circle.createWalletSet).not.toHaveBeenCalled();
  });

  it("creates the wallet and stores it with the secret key, not the user's session", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [] })] });
    const insert = queryBuilder({});
    queueTables(admin, { wallets: [insert] });

    const res = await post();

    expect(res.status).toBe(200);
    expect(insert.insert.mock.calls[0][0][0]).toMatchObject({
      user_id: USER.id,
      circle_wallet_id: "cw-1",
      type: "sca",
    });
    expect(user.from).toHaveBeenCalledTimes(1); // only the "exists?" read
  });

  it("treats losing a concurrent creation race as success", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [] })] });
    queueTables(admin, { wallets: [queryBuilder({ error: { message: "dup", code: "23505" } })] });
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/already exists/);
  });

  it("does not leak the text of an unexpected error", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [] })] });
    circle.createWalletSet.mockRejectedValue(new Error("entity secret TEST_SECRET rejected"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("TEST_SECRET");
  });
});
