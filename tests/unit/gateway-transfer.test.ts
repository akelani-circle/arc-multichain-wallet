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
const gateway = vi.hoisted(() => ({
  transferGatewayBalanceWithEOA: vi.fn(),
  executeMintCircle: vi.fn(),
  withdrawFromCustodialWallet: vi.fn(),
  getCircleWalletAddress: vi.fn(),
  checkWalletGasBalance: vi.fn(),
  CIRCLE_CHAIN_NAMES: { arcTestnet: "ARC-TESTNET", baseSepolia: "BASE-SEPOLIA", avalancheFuji: "AVAX-FUJI" },
}));
const eoa = vi.hoisted(() => ({ getGatewayEOAWalletId: vi.fn() }));
const sdk = vi.hoisted(() => ({ circleDeveloperSdk: { getWallet: vi.fn() } }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/circle/gateway-sdk", () => gateway);
vi.mock("@/lib/circle/create-gateway-eoa-wallets", () => eoa);
vi.mock("@/lib/circle/sdk", () => sdk);

import { POST } from "@/app/api/gateway/transfer/route";

const RECIPIENT = "0x" + "b2".repeat(20);
const body = (over: Record<string, unknown> = {}) => ({
  sourceChain: "arcTestnet",
  destinationChain: "baseSepolia",
  amount: "5",
  ...over,
});

const post = (payload: unknown) =>
  POST(
    new NextRequest("http://localhost/api/gateway/transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );

beforeEach(() => {
  user.from.mockReset();
  user.auth.getUser.mockReset();
  admin.from.mockReset();
  Object.values(gateway).forEach((fn) => typeof fn === "function" && (fn as ReturnType<typeof vi.fn>).mockReset());
  eoa.getGatewayEOAWalletId.mockReset();
  gateway.checkWalletGasBalance.mockResolvedValue({ hasGas: true, address: SCA_WALLET.address, balance: "1" });
  gateway.transferGatewayBalanceWithEOA.mockResolvedValue({ attestation: "0xatt", attestationSignature: "0xsig" });
  gateway.executeMintCircle.mockResolvedValue({ txHash: "0xminttx" });
});

describe("POST /api/gateway/transfer — before anything is burned", () => {
  it("refuses a signed-out caller", async () => {
    signedOut(user as UserClient);
    expect((await post(body())).status).toBe(401);
    expect(gateway.transferGatewayBalanceWithEOA).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown source chain", { sourceChain: "ethereum" }],
    ["an unknown destination chain", { destinationChain: "solana" }],
    ["a missing amount", { amount: undefined }],
    ["a non-numeric amount", { amount: "12abc" }],
    ["a negative amount", { amount: "-1" }],
    ["NaN", { amount: "NaN" }],
    ["too many decimals", { amount: "1.1234567" }],
  ])("rejects %s", async (_name, over) => {
    signedIn(user as UserClient, withWallet());
    expect((await post(body(over))).status).toBe(400);
    expect(gateway.transferGatewayBalanceWithEOA).not.toHaveBeenCalled();
    expect(gateway.executeMintCircle).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed address", "0x123"],
    ["free text", "send it to my friend"],
    ["the zero address (funds would be lost)", "0x" + "0".repeat(40)],
    ["a non-string", 42],
  ])("rejects %s as the recipient before burning anything", async (_name, recipientAddress) => {
    signedIn(user as UserClient, withWallet());
    const res = await post(body({ recipientAddress }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/recipientAddress/);
    expect(gateway.transferGatewayBalanceWithEOA).not.toHaveBeenCalled();
  });

  it("answers 404 when the user has no wallet", async () => {
    signedIn(user as UserClient, { wallets: [queryBuilder({ data: [] })] });
    expect((await post(body())).status).toBe(404);
    expect(gateway.transferGatewayBalanceWithEOA).not.toHaveBeenCalled();
  });
});

describe("POST /api/gateway/transfer — moving funds", () => {
  it("transfers exact base units to the caller's own wallet by default", async () => {
    signedIn(user as UserClient, withWallet());
    const history = queryBuilder({});
    queueTables(admin, { transaction_history: [history] });

    const res = await post(body({ amount: "0.29" }));

    expect(res.status).toBe(200);
    expect(gateway.transferGatewayBalanceWithEOA).toHaveBeenCalledWith(
      USER.id,
      BigInt(290_000),
      "arcTestnet",
      "baseSepolia",
      SCA_WALLET.address,
      SCA_WALLET.address
    );
    expect(history.insert.mock.calls[0][0][0]).toMatchObject({
      user_id: USER.id,
      tx_type: "transfer",
      tx_hash: "0xminttx",
      destination_chain: "baseSepolia",
      amount: 0.29,
    });
  });

  it("sends to a valid external recipient", async () => {
    signedIn(user as UserClient, withWallet());
    eoa.getGatewayEOAWalletId.mockResolvedValue({ walletId: "cw-eoa", address: "0x" + "e0".repeat(20) });
    queueTables(admin, { transaction_history: [queryBuilder({})] });

    const res = await post(body({ recipientAddress: RECIPIENT }));

    expect(res.status).toBe(200);
    expect(gateway.transferGatewayBalanceWithEOA.mock.calls[0][4]).toBe(RECIPIENT);
    expect((await res.json()).recipient).toBe(RECIPIENT);
  });

  it("refuses when the wallet that will mint has no gas, before burning", async () => {
    signedIn(user as UserClient, withWallet());
    gateway.checkWalletGasBalance.mockResolvedValue({ hasGas: false, address: SCA_WALLET.address });
    const res = await post(body());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INSUFFICIENT_GAS");
    expect(gateway.transferGatewayBalanceWithEOA).not.toHaveBeenCalled();
  });

  it("does not leak the text of an unexpected error", async () => {
    signedIn(user as UserClient, withWallet());
    queueTables(admin, { transaction_history: [queryBuilder({})] });
    gateway.transferGatewayBalanceWithEOA.mockRejectedValue(
      new Error("attestation service at https://internal.example failed with key TEST_API_KEY:abc")
    );

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("TEST_API_KEY");
  });
});
