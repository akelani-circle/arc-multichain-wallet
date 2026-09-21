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
import { toUserFacingError } from "@/lib/errors";

describe("toUserFacingError", () => {
  it.each([
    ["intrinsic gas too low", 400, /gas/i],
    ["ERC20: transfer amount exceeds balance", 400, /Insufficient USDC/],
    ["insufficient funds for transfer", 400, /Insufficient USDC/],
    ["allowance too low", 400, /approval/i],
    ["fetch failed: network unreachable", 503, /Network/],
    ["user rejected the request", 400, /rejected/],
  ])("maps %j to a friendly message", (raw, status, message) => {
    const result = toUserFacingError(new Error(raw));
    expect(result.status).toBe(status);
    expect(result.message).toMatch(message);
  });

  it("does not leak the text of an unrecognised error", () => {
    const secret = "Request 8f3a failed for entity 1234 at https://api.circle.com/v1/w3s/x with key TEST_API_KEY:abc";
    const result = toUserFacingError(new Error(secret));
    expect(result.status).toBe(500);
    expect(result.message).not.toContain("TEST_API_KEY");
    expect(result.message).not.toContain("circle.com");
  });

  it("handles things that are not errors", () => {
    expect(toUserFacingError("boom").status).toBe(500);
    expect(toUserFacingError(undefined).status).toBe(500);
  });
});
