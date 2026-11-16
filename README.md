# Arc Multichain Wallet

A sample application demonstrating how to build optimal USDC interoperability UX for wallets using Arc and Circle Gateway. This app showcases unified balance management, deposits, and cross-chain transfers across multiple EVM chains using Next.js and Supabase.

<img width="830" height="658" alt="Interface for depositing to and transfering from a Gateway balance" src="public/screenshot.png" />

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [How It Works](#how-it-works)
- [Environment Variables](#environment-variables)
- [Upgrading](#upgrading)
- [Testing](#testing)
- [Security & Usage Model](#security--usage-model)
- [Getting Testnet USDC](#getting-testnet-usdc)
- [Resources](#resources)

## Features

- **Sign up / sign in** (`app/auth/`) — Supabase-authenticated accounts.
- **Dashboard** (`/dashboard`) — unified, cross-chain USDC balance backed by Circle Gateway.
- **Deposit** — transfer USDC to the Gateway Wallet to make it available across every supported chain.
- **Cross-chain transfer** — sign a burn intent, get it attested by the Gateway API, and mint USDC on the destination chain.
- **Transaction history** (`/dashboard/history`) — deposits and transfers for the signed-in user.

## Prerequisites

- Node.js 20.x or newer
- npm (automatically installed when Node.js is installed)
- Docker (for running Supabase locally)
- Circle Developer Controlled Wallets [API key](https://console.circle.com/signin) and [Entity Secret](https://developers.circle.com/wallets/dev-controlled/register-entity-secret)

## Getting Started

1. Clone the repository and install dependencies:

   ```bash
   git clone git@github.com:akelani-circle/arc-multichain-wallet.git
   cd arc-multichain-wallet
   npm install
   ```
   
2. Set up environment variables:

   ```bash
   cp .env.example .env.local
   ```

   Then edit `.env.local` and fill in all required values (see [Environment Variables](#environment-variables) below).

3. Set up Supabase (Local)
   This project uses **local Supabase** via Docker for development:

   ```bash
   # Start local Supabase (requires Docker). Applies the migrations in supabase/migrations.
   npm run db:start
   ```

   The output shows the Supabase URL and keys for your `.env.local`; run `npm run db:status` to see them again.

   **Note:** If you prefer cloud-hosted Supabase, you can use:

   ```bash
   npm run supabase -- link --project-ref <your-project-ref>
   npm run supabase -- db push
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3000`.

## How It Works

- Built with [Next.js](https://nextjs.org/) and [Supabase](https://supabase.com/)
- Uses [Circle Gateway](https://developers.circle.com/gateway) for unified USDC balance and cross-chain transfers
- Integrates [Circle Developer Controlled Wallets](https://developers.circle.com/wallets/dev-controlled) for server-side wallet operations
- Demonstrates wallet connectivity with [Wagmi](https://wagmi.sh/) and [Viem](https://viem.sh/)

### Unified Balance

When you deposit USDC to the Gateway Wallet, it becomes part of your unified balance accessible from any supported chain. The Gateway Wallet uses the same address on all chains: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`

### Deposit Flow

1. Approve Gateway Wallet to spend your USDC
2. Call `deposit()` to transfer USDC to Gateway
3. Balance becomes available across all chains after finalization

### Cross-Chain Transfer Flow

1. Create and sign burn intent (EIP-712)
2. Submit to Gateway API for attestation
3. Call `gatewayMint()` on destination chain
4. USDC minted on destination

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key

# Circle
CIRCLE_API_KEY=your-circle-api-key
CIRCLE_ENTITY_SECRET=your-circle-entity-secret
```

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Supabase publishable (anon) key. |
| `SUPABASE_SECRET_KEY` | Server-side, secret | Supabase secret key. Used to write wallet rows and transaction history, which browsers cannot write. Bypasses row level security: never expose it. |
| `CIRCLE_API_KEY` | Server-side, secret | Circle API key for Gateway and wallet operations. |
| `CIRCLE_ENTITY_SECRET` | Server-side, secret | Circle entity secret for signing wallet operations. |

## Upgrading

Changes that require action on an existing deployment:

- **Add `SUPABASE_SECRET_KEY`** to `.env.local` (and to your deployment). Wallet rows and transaction history are now written by the server with it; without it, wallet creation and deposits fail.
- **Apply the new migration** (`npm run db:start` locally, `npm run supabase -- db push` on a hosted project). It:
  - enables row level security on `transaction_history`, which never had it, so **anyone with the publishable key could read every user's history and insert, edit or delete rows**. Users can now only read their own;
  - stops users inserting `wallets` rows. The deposit and transfer routes act on the user's `type = 'sca'` row with the app's Circle key, so a user-writable row was a way to point them at a wallet that was not the user's;
  - allows one `sca` wallet and one `gateway_signer` per user. **If the migration fails on the unique index, a user already has duplicates** (concurrent sign-ups could create two): keep one, remove the rest, and re-run.
- **Two routes were removed and one was closed.** `/api/deposit` was an unauthenticated mock that wrote a history row for any `userId`. `/api/wallet` and `PUT /api/wallet-set` let anyone create wallets and wallet sets on your Circle account; the "Create wallet" buttons now call the authenticated `POST /api/wallet-set`, as sign-up does.
- **Amounts are parsed exactly.** `parseFloat` accepted `NaN` and `12abc` and drifted on decimals; a deposit or transfer now needs a positive USDC amount with at most 6 decimal places.
- **`recipientAddress` is validated** before anything is burned: it must be a well-formed, non-zero address.
- **`/api/gateway/balance` only serves the caller's own wallets**, at most 10 per request.
- **Errors no longer echo internal messages** to the browser; unrecognised failures return a generic message and are logged on the server.

## Testing

- `npm test` runs the unit tests in `tests/unit`. They mock Supabase and Circle, so they need no credentials or Docker. They cover who may call each route, amount and recipient validation, and that history and wallet rows are written by the server.
- `npm run test:integration` runs `tests/integration` against the **local** Supabase stack: the row-level-security rules, exercised with real users. It reads connection settings from `.env.local`.

## Scripts

- `npm run dev`: Start Next.js development server with auto-reload
- `npm test`: Run the unit tests (no services needed)
- `npm run test:integration`: Run database tests against the local Supabase (`npm run db:start` first)
- `npm run db:start` / `db:stop` / `db:status` / `db:reset`: Manage the local Supabase instance

## Security & Usage Model

This sample application:
- Assumes testnet usage only — never use mainnet private keys with this application
- Handles secrets via environment variables
- Processes private keys server-side and never stores them
- Writes wallets and transaction history only from server routes, and checks the caller owns the wallet before moving funds
- Is not intended for production use without modification

See `SECURITY.md` for vulnerability reporting guidelines. Please report issues privately via Circle's bug bounty program.

## Getting Testnet USDC

To test the application, you'll need testnet USDC on the supported chains. Use the Circle Faucet to get free testnet tokens:

### Using the Circle Faucet

1. **Get Your Wallet Address**: After signing up, your Circle Wallet addresses will be displayed in the dashboard
2. **Visit the Faucet**: Go to [https://faucet.circle.com/](https://faucet.circle.com/)
3. **Request Tokens**: 
   - Enter your wallet address
   - Select the desired testnet (Arc Testnet, Base Sepolia, or Avalanche Fuji)
   - Request USDC
4. **Wait for Confirmation**: Transactions typically confirm within a few minutes
5. **Deposit to Gateway**: Once received, use the "Deposit" tab to add USDC to your Gateway balance

### Supported Testnets

- **Arc Testnet**: Primary chain for deposits and Gateway operations
- **Base Sepolia**: Ethereum Layer 2 testnet
- **Avalanche Fuji**: Avalanche testnet

### Note on Gas Fees

When transferring USDC cross-chain, you'll need native tokens on the destination chain to pay for gas fees:
- **Arc Testnet**: USDC (no additional gas token needed)
- **Base Sepolia**: ETH (get from [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia))
- **Avalanche Fuji**: AVAX (get from [Avalanche Faucet](https://core.app/tools/testnet-faucet/))

## Resources

- [Circle Gateway Documentation](https://developers.circle.com/gateway)
- [Unified Balance Guide](https://developers.circle.com/gateway/howtos/create-unified-usdc-balance)
- [Circle Faucet](https://faucet.circle.com/)
