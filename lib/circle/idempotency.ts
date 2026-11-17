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

import { createHash } from "crypto";

/**
 * A stable idempotency key (UUID format) for a one-off Circle call, such as creating a user's
 * wallets. Circle answers a repeated key with the first request's result instead of creating
 * a second wallet, so concurrent or retried requests can't leave duplicate wallets behind.
 */
export function idempotencyKeyFor(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Runs a Circle call that carries a fixed idempotency key. While the first request with a key
 * is still in flight, Circle rejects duplicates (seen: codes 2 and 156021); once it finishes it
 * returns the same result. So a rejected duplicate is retried once, after a short pause.
 */
export async function withIdempotentRetry<T>(call: () => Promise<T>, retryDelayMs = 2_000): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.warn("Circle call failed, retrying once with the same idempotency key:", error);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return call();
  }
}
