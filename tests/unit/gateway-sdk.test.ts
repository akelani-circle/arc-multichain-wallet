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

const circle = vi.hoisted(() => ({
  getTransaction: vi.fn(),
  createContractExecutionTransaction: vi.fn(),
  signTypedData: vi.fn(),
}));
const publicClient = vi.hoisted(() => ({ readContract: vi.fn(), getBalance: vi.fn() }));
const eoa = vi.hoisted(() => ({ getGatewayEOAWalletId: vi.fn() }));

vi.mock("@/lib/circle/sdk", () => ({ circleDeveloperSdk: circle }));
vi.mock("@/lib/circle/create-gateway-eoa-wallets", () => eoa);
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => publicClient,
}));

import {
  arcTestnet,
  initiateDepositFromCustodialWallet,
  transferGatewayBalanceWithEOA,
  waitForTransactionConfirmation,
  InsufficientGatewayBalanceError,
} from "@/lib/circle/gateway-sdk";

const SCA = `0x${"a1".repeat(20)}` as const;
const EOA = `0x${"e0".repeat(20)}` as const;
const fetchMock = vi.fn();

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body, text: async () => "" });

beforeEach(() => {
  Object.values(circle).forEach((fn) => fn.mockReset());
  Object.values(publicClient).forEach((fn) => fn.mockReset());
  eoa.getGatewayEOAWalletId.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  circle.createContractExecutionTransaction.mockResolvedValue({ data: { id: "challenge-1" } });
  circle.getTransaction.mockResolvedValue({ data: { transaction: { state: "CONFIRMED", txHash: "0xtx" } } });
  eoa.getGatewayEOAWalletId.mockResolvedValue({ walletId: "cw-eoa", address: EOA });
});

describe("arcTestnet chain", () => {
  it("has USDC with 18 decimals as its native gas token and no hardcoded RPC key", () => {
    expect(arcTestnet.nativeCurrency).toMatchObject({ symbol: "USDC", decimals: 18 });
    expect(arcTestnet.rpcUrls.default.http.join()).not.toContain("c0ca2582063a5bbd5db2f98c139775e982b16919");
  });
});

describe("waitForTransactionConfirmation", () => {
  it.each(["FAILED", "CANCELLED", "DENIED", "STUCK"])("stops polling when Circle reports %s", async (state) => {
    circle.getTransaction.mockResolvedValue({ data: { transaction: { state, errorReason: "INSUFFICIENT_TOKEN" } } });
    await expect(waitForTransactionConfirmation("c-1", { intervalMs: 0 })).rejects.toThrow(
      /INSUFFICIENT_TOKEN/
    );
    expect(circle.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout instead of polling forever", async () => {
    circle.getTransaction.mockResolvedValue({ data: { transaction: { state: "SENT" } } });
    await expect(waitForTransactionConfirmation("c-1", { timeoutMs: 20, intervalMs: 5 })).rejects.toThrow(
      /not confirmed within/
    );
  });
});

describe("initiateDepositFromCustodialWallet", () => {
  it.each([
    ["baseSepolia", "BASE-SEPOLIA", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"],
    ["avalancheFuji", "AVAX-FUJI", "0x5425890298aed601595a70ab815c96711a31bc65"],
  ] as const)("runs every step on %s, picking the wallet by address + blockchain", async (chain, blockchain, usdc) => {
    publicClient.readContract.mockResolvedValue(false);

    await initiateDepositFromCustodialWallet(SCA, chain, BigInt(1_000_000), EOA);

    const calls = circle.createContractExecutionTransaction.mock.calls.map(([input]) => input);
    expect(calls.map((c) => c.abiFunctionSignature)).toEqual([
      "addDelegate(address,address)",
      "approve(address,uint256)",
      "deposit(address,uint256)",
    ]);
    for (const input of calls) {
      expect(input).toMatchObject({ walletAddress: SCA, blockchain });
      expect(input).not.toHaveProperty("walletId");
    }
    expect(calls[2].abiParameters).toEqual([usdc, "1000000"]);
  });

  it("does not add the delegate again when it already is one", async () => {
    publicClient.readContract.mockResolvedValue(true);

    await initiateDepositFromCustodialWallet(SCA, "arcTestnet", BigInt(1_000_000), EOA);

    const signatures = circle.createContractExecutionTransaction.mock.calls.map(([i]) => i.abiFunctionSignature);
    expect(signatures).toEqual(["approve(address,uint256)", "deposit(address,uint256)"]);
  });
});

describe("transferGatewayBalanceWithEOA", () => {
  const routeFetch = (fee: string, balance: string) =>
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/estimate")) return jsonResponse([{ burnIntent: { maxFee: fee } }]);
      if (url.endsWith("/balances")) {
        return jsonResponse({ token: "USDC", balances: [{ domain: 26, depositor: SCA, balance }] });
      }
      if (url.endsWith("/transfer")) {
        return jsonResponse([{ attestation: "0xatt", signature: "0xsig", transferId: "t-1" }]);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

  it("refuses before signing when the balance covers the amount but not the fee", async () => {
    routeFetch("3850", "1.000000");

    const transfer = transferGatewayBalanceWithEOA("user-1", BigInt(1_000_000), "arcTestnet", "arcTestnet", SCA, SCA);

    await expect(transfer).rejects.toBeInstanceOf(InsufficientGatewayBalanceError);
    await expect(transfer).rejects.toThrow(/1\.00385 USDC.*0\.00385 USDC fee.*1 USDC is available/);
    expect(circle.signTypedData).not.toHaveBeenCalled();
  });

  it("signs a burn intent whose maxFee is the fee Gateway asked for", async () => {
    routeFetch("3850", "1.003850");
    circle.signTypedData.mockResolvedValue({ data: { signature: "0xsigned" } });

    const result = await transferGatewayBalanceWithEOA("user-1", BigInt(1_000_000), "arcTestnet", "arcTestnet", SCA, SCA);

    expect(result).toEqual({ transferId: "t-1", attestation: "0xatt", attestationSignature: "0xsig" });
    const signed = JSON.parse(circle.signTypedData.mock.calls[0][0].data);
    expect(signed.message.maxFee).toBe("3850");
    expect(signed.message.spec.value).toBe("1000000");
    const submitted = JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith("/transfer"))![1].body);
    expect(submitted[0].burnIntent.maxFee).toBe("3850");
  });
});
