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
import { queryBuilder } from "../helpers/supabase-mock";
import { SCA_WALLET, signedIn, signedOut, type UserClient } from "../helpers/scenario";

const user = vi.hoisted(() => ({ from: vi.fn(), auth: { getUser: vi.fn() } }));
const gateway = vi.hoisted(() => ({
  fetchGatewayBalance: vi.fn(),
  getUsdcBalance: vi.fn(),
  CHAIN_BY_DOMAIN: { 26: "arcTestnet" } as Record<number, string>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => user }));
vi.mock("@/lib/circle/gateway-sdk", () => gateway);

import { POST } from "@/app/api/gateway/balance/route";

const EOA = "0x" + "e0".repeat(20);
const STRANGER = "0x" + "cc".repeat(20);

const post = (addresses: unknown) =>
  POST(
    new NextRequest("http://localhost/api/gateway/balance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses }),
    })
  );

const ownWallets = () => ({
  wallets: [
    queryBuilder({
      data: [
        { address: SCA_WALLET.address, wallet_address: SCA_WALLET.address },
        { address: EOA, wallet_address: EOA },
      ],
    }),
  ],
});

beforeEach(() => {
  user.from.mockReset();
  user.auth.getUser.mockReset();
  gateway.fetchGatewayBalance.mockReset();
  gateway.getUsdcBalance.mockReset();
  gateway.fetchGatewayBalance.mockResolvedValue({ balances: [] });
  gateway.getUsdcBalance.mockResolvedValue(BigInt(2_000_000));
});

describe("POST /api/gateway/balance", () => {
  it("refuses a signed-out caller", async () => {
    signedOut(user as UserClient);
    expect((await post([SCA_WALLET.address])).status).toBe(401);
    expect(gateway.fetchGatewayBalance).not.toHaveBeenCalled();
  });

  it.each([
    ["nothing", []],
    ["not an array", "0xabc"],
    ["a malformed address", ["not-an-address"]],
    ["non-strings", [1, 2]],
    ["more than the limit (a fan-out onto the app's Circle and RPC quota)", Array.from({ length: 11 }, () => SCA_WALLET.address)],
  ])("rejects %s", async (_name, addresses) => {
    signedIn(user as UserClient, ownWallets());
    expect((await post(addresses)).status).toBe(400);
    expect(gateway.fetchGatewayBalance).not.toHaveBeenCalled();
    expect(gateway.getUsdcBalance).not.toHaveBeenCalled();
  });

  it("refuses any address that is not one of the caller's own wallets", async () => {
    signedIn(user as UserClient, ownWallets());
    const res = await post([SCA_WALLET.address, STRANGER]);
    expect(res.status).toBe(403);
    expect(gateway.fetchGatewayBalance).not.toHaveBeenCalled();
    expect(gateway.getUsdcBalance).not.toHaveBeenCalled();
  });

  it("reads balances for the caller's own wallets, matching in any case", async () => {
    signedIn(user as UserClient, ownWallets());
    const res = await post([SCA_WALLET.address.toUpperCase().replace("0X", "0x"), EOA]);
    expect(res.status).toBe(200);
    expect(gateway.fetchGatewayBalance).toHaveBeenCalledTimes(2);
  });
});
