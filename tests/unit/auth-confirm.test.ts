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

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));

import { GET } from "@/app/auth/confirm/route";

const get = async (query: string) => {
  const res = await GET(new NextRequest(`http://localhost:3000/auth/confirm?${query}`));
  return new URL(res.headers.get("location")!);
};

beforeEach(() => {
  auth.exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  auth.verifyOtp.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/confirm (email links)", () => {
  it("signs in with the link's code and continues to next", async () => {
    const to = await get("code=abc&next=/auth/update-password");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(to.pathname).toBe("/auth/update-password");
  });

  it("accepts a token hash link", async () => {
    const to = await get("token_hash=h1&type=signup");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "h1" });
    expect(to.pathname).toBe("/dashboard");
  });

  it.each(["//evil.example", "https://evil.example", "evil"])("never redirects off-site (next=%s)", async (next) => {
    const to = await get(`code=abc&next=${encodeURIComponent(next)}`);
    expect(to.origin).toBe("http://localhost:3000");
    expect(to.pathname).toBe("/dashboard");
  });

  it("shows the error page for a missing or rejected code", async () => {
    expect((await get("")).pathname).toBe("/auth/error");
    auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    const to = await get("code=old");
    expect(to.pathname).toBe("/auth/error");
    expect(to.searchParams.get("error")).toBe("expired");
  });
});
