-- Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.
--
-- SPDX-License-Identifier: Apache-2.0

-- Lock down wallets and transaction history.
--
--   * transaction_history was created WITHOUT row level security. On Supabase that means
--     anyone holding the publishable key could read every user's history (chain, amounts,
--     wallet addresses) and insert, edit or delete rows.
--   * wallets let users INSERT their own rows. The money-moving routes trust the row
--     with type = 'sca' as "my wallet" and act on its circle_wallet_id with the app's
--     Circle key, so a user-writable row is a way to point them at a wallet that is not
--     the user's.
--
-- Both tables are now written only by server routes, with the secret key. Users can read
-- their own rows.

-- ===========================================================================
-- transaction_history
-- ===========================================================================

ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own history"
ON public.transaction_history
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.transaction_history FROM anon, authenticated;
GRANT SELECT ON public.transaction_history TO authenticated;

-- NOT VALID: enforced for new rows without failing on any old ones.
ALTER TABLE public.transaction_history
  ADD CONSTRAINT transaction_history_tx_type_check CHECK (tx_type IN ('deposit', 'transfer', 'unify')) NOT VALID,
  ADD CONSTRAINT transaction_history_amount_check CHECK (amount > 0) NOT VALID,
  ADD CONSTRAINT transaction_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE NOT VALID;

-- ===========================================================================
-- wallets
-- ===========================================================================

DROP POLICY IF EXISTS "Allow authenticated users to create their own wallet" ON public.wallets;

-- Re-created with the auth call wrapped in a sub-select, so it is evaluated once per
-- statement instead of once per row (advisor lint 0003).
DROP POLICY IF EXISTS "Allow authenticated users to read their own wallets" ON public.wallets;

CREATE POLICY "Allow authenticated users to read their own wallets"
ON public.wallets
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.wallets FROM anon, authenticated;
GRANT SELECT ON public.wallets TO authenticated;

-- One SCA wallet and one gateway signer per user. Two concurrent sign-up requests used to
-- both pass the "does a wallet exist?" check and create two wallets. If this fails, a user
-- already has duplicates: remove the extras, then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_type_key
ON public.wallets (user_id, type)
WHERE type IN ('sca', 'gateway_signer');
