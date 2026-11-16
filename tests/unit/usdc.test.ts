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

import { describe, expect, it } from "vitest";
import { MAX_USDC_PER_REQUEST, parseUsdcAmount } from "@/lib/usdc";

describe("parseUsdcAmount", () => {
  it.each([
    ["1", BigInt(1_000_000), 1],
    ["0.5", BigInt(500_000), 0.5],
    [".5", BigInt(500_000), 0.5],
    ["12.345678", BigInt(12_345_678), 12.345678],
    ["  7 ", BigInt(7_000_000), 7],
    ["0.000001", BigInt(1), 0.000001],
    [5, BigInt(5_000_000), 5],
    [0.1, BigInt(100_000), 0.1],
  ])("accepts %j exactly", (input, atomic, value) => {
    expect(parseUsdcAmount(input)).toEqual({ atomic, value });
  });

  it("does not drift on decimals (Math.floor(0.29 * 1e6) is 289999)", () => {
    expect(parseUsdcAmount("0.29")?.atomic).toBe(BigInt(290_000));
  });

  it.each(["0", "0.0", "0.000000", "-1", "+1", "1e3", "1e400", "12abc", "1.", "abc", "", " ", "NaN", "Infinity", "0x10", "1.1234567", "1,5"])(
    "rejects %j",
    (input) => {
      expect(parseUsdcAmount(input)).toBeNull();
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5, 0])("rejects the number %j", (input) => {
    expect(parseUsdcAmount(input)).toBeNull();
  });

  it("rejects non-strings and non-numbers", () => {
    for (const input of [null, undefined, {}, ["1"], true]) {
      expect(parseUsdcAmount(input)).toBeNull();
    }
  });

  it("enforces the per-request maximum", () => {
    expect(parseUsdcAmount(String(MAX_USDC_PER_REQUEST))).not.toBeNull();
    expect(parseUsdcAmount(String(MAX_USDC_PER_REQUEST + 1))).toBeNull();
  });
});
