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

import type { vi } from "vitest";
import { queryBuilder, queueTables, type QueryBuilder } from "./supabase-mock";

export type UserClient = {
  from: ReturnType<typeof vi.fn>;
  auth: { getUser: ReturnType<typeof vi.fn> };
};

export const USER = { id: "user-alice" };
export const SCA_WALLET = {
  circle_wallet_id: "cw-sca",
  wallet_set_id: "ws-1",
  address: "0x" + "a1".repeat(20),
};

export function signedOut(client: UserClient) {
  client.auth.getUser.mockResolvedValue({ data: { user: null } });
  client.from.mockImplementation((table: string) => {
    throw new Error(`Signed-out request must not query "${table}"`);
  });
}

export function signedIn(client: UserClient, tables: Record<string, QueryBuilder[]> = {}) {
  client.auth.getUser.mockResolvedValue({ data: { user: USER } });
  queueTables(client, tables);
}

export const withWallet = () => ({ wallets: [queryBuilder({ data: [SCA_WALLET] })] });
