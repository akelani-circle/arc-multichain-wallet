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

/**
 * Turns an error thrown while talking to Circle or a chain into a message that is safe
 * and useful to show a user, and a status code. Anything unrecognised becomes a generic
 * message: raw SDK errors can carry request details and internal identifiers.
 */
export function toUserFacingError(error: unknown): { message: string; status: number } {
  const raw = error instanceof Error ? error.message : "";
  const msg = raw.toLowerCase();

  if (msg.includes("gas") || msg.includes("intrinsic") || msg.includes("fee")) {
    return {
      message:
        "Insufficient gas or gas estimation failed. Please ensure you have enough native tokens for gas fees.",
      status: 400,
    };
  }
  if (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("transfer amount exceeds balance") ||
    msg.includes("exceeds balance")
  ) {
    return {
      message: "Insufficient USDC balance for this operation. Please check your balance and try again.",
      status: 400,
    };
  }
  if (msg.includes("allowance") || msg.includes("approve")) {
    return { message: "Token approval failed. Please try again.", status: 400 };
  }
  if (msg.includes("network") || msg.includes("rpc") || msg.includes("timeout")) {
    return { message: "Network error. Please check your connection and try again.", status: 503 };
  }
  if (msg.includes("user rejected") || msg.includes("user denied")) {
    return { message: "Transaction was rejected.", status: 400 };
  }
  return { message: "Something went wrong. Please try again.", status: 500 };
}
