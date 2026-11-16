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

const USDC_AMOUNT = /^(?:\d+|\d+\.\d{1,6}|\.\d{1,6})$/;

/** Largest amount a single request may move, in USDC. */
export const MAX_USDC_PER_REQUEST = 1_000_000_000;

/**
 * Parses a user-supplied USDC amount: a plain positive decimal with at most 6 decimal
 * places. Rejects NaN, Infinity, exponents, signs and zero. (parseFloat accepts "1e400",
 * "12abc" and NaN, and `Math.floor(x * 1e6)` drifts on decimals.) Returns exact base units.
 */
export function parseUsdcAmount(
  input: unknown,
): { atomic: bigint; value: number } | null {
  const text =
    typeof input === "number" && Number.isFinite(input)
      ? input.toFixed(6).replace(/\.?0+$/, "")
      : typeof input === "string"
        ? input.trim()
        : null;
  if (text === null || !USDC_AMOUNT.test(text)) return null;

  const [whole = "0", fraction = ""] = text.split(".");
  const atomic =
    BigInt(whole || "0") * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0") || "0");

  if (atomic <= BigInt(0)) return null;
  if (atomic > BigInt(MAX_USDC_PER_REQUEST) * BigInt(1_000_000)) return null;

  return { atomic, value: Number(text) };
}
