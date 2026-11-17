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

"use client";

import { Button } from "@/components/ui/button";
import { useAccount, useConnections } from "wagmi";
import { ConnectWallet } from "@/components/connect-wallet";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import {
  CHAIN_NAMES,
  NATIVE_TOKENS,
  SUPPORTED_CHAINS,
  type ChainBalance,
  type GatewayChainBalance,
  type SupportedChain,
} from "@/lib/chain-config";
import { parseUsdcAmount } from "@/lib/usdc";
import { AlertCircleIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator"
import { TransactionHistory } from "@/components/transaction-history";
import { toast } from "sonner";
import { Copy, RefreshCw, Info, ArrowLeftRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AddressBalances {
  address: string;
  gatewayBalances?: GatewayChainBalance[];
  chainBalances?: ChainBalance[];
  gatewayTotal?: number;
  walletTotal?: number;
  totalBalance: number;
}

interface BalancesResponse {
  totalUnified: number;
  balances: AddressBalances[];
}

interface TransferQuote {
  fee: string;
  available: string;
  required: string;
  sufficient: boolean;
}

const formatUsdc = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });

// USDC amounts from the API are decimals; compare them in exact base units.
const toAtomic = (value: number) => BigInt(Math.round(value * 1_000_000));

const subscribeToNothing = () => () => {};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function sumByChain(entries: ChainBalance[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, { chain, balance }) => {
    acc[chain] = (acc[chain] ?? 0) + balance;
    return acc;
  }, {});
}

function ChainSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: SupportedChain;
  onChange: (chain: SupportedChain) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SupportedChain)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select chain" />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_CHAINS.map((chain) => (
          <SelectItem key={chain.value} value={chain.value}>
            {chain.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WalletDashboard() {
  // false during server rendering and hydration, true afterwards
  const isMounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const queryClient = useQueryClient();

  const [hasCircleWallet, setHasCircleWallet] = useState(false);
  const [circleWalletAddresses, setCircleWalletAddresses] = useState<string[]>([]);
  const [isCheckingCircleWallet, setIsCheckingCircleWallet] = useState(true);

  useEffect(() => {
    const initializeWallets = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Initialize EOA wallets for Gateway signing. Safe to repeat (the dev-mode double
        // effect calls it twice): the server returns the existing wallet.
        try {
          await fetch("/api/gateway/init-eoa-wallets", { method: "POST" });
        } catch (error) {
          console.error("Failed to initialize EOA wallets:", error);
        }

        // Check for Circle Wallet (exclude EOA signer wallets from UI)
        const { data, error } = await supabase
          .from("wallets")
          .select("wallet_address, type")
          .eq("user_id", user.id)
          .neq("type", "gateway_signer"); // Exclude EOA signer wallets

        if (data && data.length > 0 && !error) {
          setHasCircleWallet(true);
          setCircleWalletAddresses(data.map(w => w.wallet_address));
        } else {
          setHasCircleWallet(false);
          setCircleWalletAddresses([]);
        }
      }
      setIsCheckingCircleWallet(false);
    };
    initializeWallets();
  }, []);

  const { isConnected, isConnecting } = useAccount();
  const connections = useConnections();

  // Create a unified list of all wallet addresses (from wagmi and Circle)
  const allWalletAddresses = useMemo(() => {
    const wagmiAddresses = connections.map((conn) => conn.accounts).flat();
    return Array.from(new Set([...wagmiAddresses, ...circleWalletAddresses]));
  }, [connections, circleWalletAddresses]);

  // Helper function to format address suffix
  const formatAddressSuffix = (address: string) => {
    if (!address || address.length < 10) return "";
    return `(${address.slice(0, 5)}...${address.slice(-4)})`;
  };

  // Helper function to copy address to clipboard
  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address Copied", {
        description: "Wallet address copied to clipboard",
      });
    } catch {
      toast.error("Copy Failed", {
        description: "Failed to copy address to clipboard",
      });
    }
  };

  // Balances, refreshed every 30 seconds
  const balancesQuery = useQuery({
    queryKey: ["balances", allWalletAddresses],
    enabled: !isCheckingCircleWallet && allWalletAddresses.length > 0,
    refetchInterval: 30_000,
    queryFn: async (): Promise<BalancesResponse> => {
      const response = await fetch("/api/gateway/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses: allWalletAddresses }),
      });
      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }
      return response.json();
    },
  });

  useEffect(() => {
    if (balancesQuery.error) {
      toast.error("Balance Update Failed", {
        description: `Failed to fetch balances: ${balancesQuery.error.message}`,
      });
    }
  }, [balancesQuery.error]);

  const balances = useMemo(() => {
    const entries = balancesQuery.data?.balances ?? [];
    const gateway = entries.flatMap((b) => b.gatewayBalances ?? []);
    const wallet = entries.flatMap((b) => b.chainBalances ?? []);
    return {
      total: balancesQuery.data ? balancesQuery.data.totalUnified : null,
      gatewayTotal: entries.reduce((sum, b) => sum + (b.gatewayTotal || 0), 0),
      walletTotal: entries.reduce((sum, b) => sum + (b.walletTotal || 0), 0),
      gatewayBalances: gateway,
      chainBalances: wallet,
      gatewayByChain: sumByChain(gateway),
      walletByChain: sumByChain(wallet),
    };
  }, [balancesQuery.data]);

  const balanceLoading =
    isCheckingCircleWallet || (allWalletAddresses.length > 0 && balancesQuery.isPending);

  const refreshAfterTransaction = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["balances"] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
    ]);

  // Deposit state
  const [depositChain, setDepositChain] = useState<SupportedChain>("arcTestnet");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositLoading, setDepositLoading] = useState(false);

  // Transfer state
  const [sourceChain, setSourceChain] = useState<SupportedChain>("arcTestnet");
  const [destinationChain, setDestinationChain] = useState<SupportedChain>("baseSepolia");
  const [transferAmount, setTransferAmount] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);

  const depositAtomic = parseUsdcAmount(depositAmount)?.atomic ?? null;
  const depositWalletBalance = balances.walletByChain[depositChain] ?? 0;
  const depositExceedsBalance =
    depositAtomic !== null && depositAtomic > toAtomic(depositWalletBalance);

  // Gateway takes its fee from the source chain's balance on top of the amount, so the
  // dashboard asks the server for the fee before allowing a transfer.
  const debouncedTransferAmount = useDebouncedValue(transferAmount, 400);
  const quoteAmount = parseUsdcAmount(debouncedTransferAmount) ? debouncedTransferAmount : null;
  const quoteQuery = useQuery({
    queryKey: ["transfer-quote", sourceChain, destinationChain, quoteAmount],
    enabled: hasCircleWallet && quoteAmount !== null,
    staleTime: 15_000,
    retry: false,
    queryFn: async (): Promise<TransferQuote> => {
      const response = await fetch("/api/gateway/fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceChain, destinationChain, amount: quoteAmount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not estimate the fee");
      return data;
    },
  });
  const transferAtomic = parseUsdcAmount(transferAmount)?.atomic ?? null;
  const sourceGatewayBalance = balances.gatewayByChain[sourceChain] ?? 0;
  const quote = quoteAmount === transferAmount ? quoteQuery.data : undefined;
  const transferFeeAtomic = quote ? parseUsdcAmount(quote.fee)?.atomic ?? BigInt(0) : BigInt(0);
  const transferExceedsBalance =
    transferAtomic !== null &&
    transferAtomic + transferFeeAtomic > toAtomic(sourceGatewayBalance);
  const quotePending = transferAtomic !== null && !quote && !quoteQuery.isError;

  const handleDeposit = async () => {
    if (!depositAmount) {
      toast.error("Invalid Amount", {
        description: "Please provide an amount to deposit.",
      });
      return;
    }
    if (!hasCircleWallet) {
      toast.error("No Circle Wallet", {
        description: "Create a Circle wallet first.",
      });
      return;
    }

    setDepositLoading(true);

    // One toast for the whole deposit: it is updated, then replaced by the result
    const progressToast = toast.loading("Processing Deposit...", {
      description: `Approving and depositing USDC on ${CHAIN_NAMES[depositChain]}`,
    });

    try {
      const response = await fetch("/api/gateway/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: depositChain, amount: depositAmount }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Deposit failed");
      }
      const data = await response.json();

      toast.success("Deposit Successful", {
        id: progressToast,
        description: `Transaction Hash: ${data.txHash}`,
      });

      setDepositAmount("");

      // Instantly refresh balance and history
      await refreshAfterTransaction();
    } catch (err: unknown) {
      toast.error("Deposit Failed", {
        id: progressToast,
        description: err instanceof Error ? err.message : "An error occurred during deposit",
      });
    } finally {
      setDepositLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferAmount) {
      toast.error("Invalid Amount", {
        description: "Please provide an amount to transfer.",
      });
      return;
    }
    if (!hasCircleWallet) {
      toast.error("No Circle Wallet", {
        description: "Create a Circle wallet first.",
      });
      return;
    }
    // Same-chain transfers are allowed (withdrawal from Gateway to wallet)
    // Cross-chain transfers will go through Gateway's burn/mint process

    setTransferLoading(true);

    const progressToast = toast.loading("Processing Transfer...", {
      description: `Burning on ${CHAIN_NAMES[sourceChain]} and minting USDC on ${CHAIN_NAMES[destinationChain]}`,
    });

    try {
      const response = await fetch("/api/gateway/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceChain,
          destinationChain,
          amount: transferAmount,
          recipientAddress: recipientAddress || undefined,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const errorMessage: string = error.error || "Transfer failed";

        // Handle insufficient gas error with wallet details
        if (errorMessage === "INSUFFICIENT_GAS" && error.walletAddress) {
          const chainName = CHAIN_NAMES[destinationChain];
          const nativeToken = NATIVE_TOKENS[destinationChain];

          // Show detailed error with copy button for wallet address
          toast.error("Insufficient Gas", {
            id: progressToast,
            description: (
              <div className="space-y-2">
                <p>Your EOA wallet needs {nativeToken} on {chainName} to execute the mint.</p>
                <div className="flex items-center gap-2 bg-muted p-2 rounded text-xs font-mono">
                  <span className="flex-1 truncate">{error.walletAddress}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 p-0"
                    onClick={() => copyAddress(error.walletAddress)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs">Send {nativeToken} to this address and try again.</p>
              </div>
            ),
            duration: 10000, // Show for 10 seconds
          });
          return; // Exit early, don't throw
        }

        throw new Error(errorMessage);
      }
      const data = await response.json();

      toast.success("Transfer Successful", {
        id: progressToast,
        description: `Mint Transaction Hash: ${data.mintTxHash}`,
      });

      setTransferAmount("");
      setRecipientAddress("");

      // Instantly refresh balance and history
      await refreshAfterTransaction();
    } catch (err: unknown) {
      toast.error("Transfer Failed", {
        id: progressToast,
        description:
          err instanceof Error ? err.message : "An unexpected error occurred. Please try again.",
      });
    } finally {
      setTransferLoading(false);
    }
  };

  // This prevents the server (disconnected) and client (connected) mismatch
  const userHasWallet = (isMounted && isConnected) || hasCircleWallet;

  return (
    <>
      {/* Disconnected State View */}
      <div className={userHasWallet ? 'hidden' : 'block'}>
        <Card>
          <CardHeader>
            <CardTitle>Wallet Setup</CardTitle>
            <CardDescription>
              Create your Circle wallet to begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConnectWallet />
          </CardContent>
        </Card>
      </div>

      {/* Connected State View */}
      <div className={userHasWallet ? 'block' : 'hidden'}>
        <div className="space-y-6">
          {/* Top Row: Wallet and Balances */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Wallet Setup</CardTitle>
                <CardDescription>
                  Your Circle wallet has the same address on every supported chain.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConnectWallet />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>USDC Balance Overview</CardTitle>
                    <CardDescription>
                      Your combined balance across all wallets and chains.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => balancesQuery.refetch()}
                    disabled={balanceLoading || balancesQuery.isFetching}
                  >
                    <RefreshCw className={`h-4 w-4 ${balancesQuery.isFetching ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {balanceLoading || isConnecting ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-[200px]" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : balances.total !== null ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        Gateway Balance (unified)
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/70" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[280px]">
                              <p>Gateway provides a unified USDC balance across multiple chains. You can deposit on any chain and transfer to any other - Gateway handles the cross-chain routing automatically.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </p>
                      <p className="text-2xl font-bold">
                        {formatUsdc(balances.gatewayTotal)} USDC
                      </p>
                    </div>
                    {balances.gatewayBalances.some(gb => gb.balance > 0) && (
                      <ul className="text-xs space-y-1 mt-[-8px] text-muted-foreground">
                        {balances.gatewayBalances.filter(gb => gb.balance > 0).map((gb) => (
                          <li
                            key={`gateway-${gb.address}-${gb.domain}`}
                            className="flex justify-between items-center gap-2"
                          >
                            <span>Deposited on {CHAIN_NAMES[gb.chain as SupportedChain] ?? gb.chain}</span>
                            <span className="font-mono">{gb.balance.toFixed(6)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Separator className="my-4" />
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Wallet Balance
                      </p>
                      <p className="text-2xl font-bold">
                        {formatUsdc(balances.walletTotal)} USDC
                      </p>
                    </div>
                    {balances.chainBalances.filter(cb => cb.balance > 0).length > 0 ? (
                      <ul className="text-xs space-y-1 mt-[-8px] text-muted-foreground">
                        {balances.chainBalances.filter(cb => cb.balance > 0).map((cb, idx) => (
                          <li
                            key={`wallet-${idx}-${cb.chain}-${cb.balance}`}
                            className="flex justify-between items-center gap-2"
                          >
                            <span className="flex items-center gap-2">
                              {CHAIN_NAMES[cb.chain as SupportedChain] ?? cb.chain}
                              <span className="text-[10px] text-muted-foreground">{formatAddressSuffix(cb.address)}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => copyAddress(cb.address)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </span>
                            <span className="font-mono">
                              {cb.balance.toFixed(6)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No wallet balance on any chain
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Actions Card with Tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                Manage your unified balance by depositing or transferring funds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="deposit">
                <TabsList className="w-full">
                  <TabsTrigger value="deposit">Deposit</TabsTrigger>
                  <TabsTrigger value="transfer">Transfer</TabsTrigger>
                </TabsList>

                <TabsContent value="deposit" className="pt-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="deposit-chain">From</Label>
                      <ChainSelect
                        id="deposit-chain"
                        value={depositChain}
                        onChange={setDepositChain}
                        disabled={depositLoading}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deposit-amount">Amount (USDC)</Label>
                      <Input
                        id="deposit-amount"
                        type="number"
                        step="0.01"
                        placeholder="10.00"
                        className="w-full"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        disabled={depositLoading}
                      />
                      <p className="text-xs text-muted-foreground">
                        Wallet balance on {CHAIN_NAMES[depositChain]}: {formatUsdc(depositWalletBalance)} USDC
                        {depositExceedsBalance && (
                          <span className="text-red-500"> (Insufficient balance)</span>
                        )}
                      </p>
                    </div>
                    <Button
                      onClick={handleDeposit}
                      disabled={depositLoading || !hasCircleWallet || depositAtomic === null || depositExceedsBalance}
                      className="w-full"
                    >
                      {depositLoading ? "Processing..." : "Deposit"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="transfer" className="pt-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="source-chain">From</Label>
                        <ChainSelect
                          id="source-chain"
                          value={sourceChain}
                          onChange={setSourceChain}
                          disabled={transferLoading}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="destination-chain">To</Label>
                        <ChainSelect
                          id="destination-chain"
                          value={destinationChain}
                          onChange={setDestinationChain}
                          disabled={transferLoading}
                        />
                      </div>
                    </div>
                    {sourceChain !== destinationChain && (
                      <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-950">
                        <ArrowLeftRight className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          Cross-chain transfer: Gateway will route USDC from{" "}
                          <span className="font-medium">{CHAIN_NAMES[sourceChain]}</span> to{" "}
                          <span className="font-medium">{CHAIN_NAMES[destinationChain]}</span> via burn/mint.
                        </p>
                      </div>
                    )}
                    <Alert>
                      <AlertCircleIcon className="h-4 w-4" />
                      <AlertTitle>Gas Fees</AlertTitle>
                      <AlertDescription>
                        Minting to your own wallet needs no gas tokens: Circle Gas Station pays for your
                        smart contract wallet. Sending to another address mints from your signer wallet,
                        which needs {NATIVE_TOKENS[destinationChain]} on {CHAIN_NAMES[destinationChain]}.
                      </AlertDescription>
                    </Alert>
                    <div className="space-y-2">
                      <Label htmlFor="transfer-amount-gateway">Amount (USDC)</Label>
                      <Input
                        id="transfer-amount-gateway"
                        type="number"
                        step="0.01"
                        placeholder="5.00"
                        className="w-full"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        disabled={transferLoading}
                      />
                      <p className="text-xs text-muted-foreground">
                        Gateway balance on {CHAIN_NAMES[sourceChain]}: {formatUsdc(sourceGatewayBalance)} USDC
                        {quote && <> · Gateway fee: up to {quote.fee} USDC, taken on top of the amount</>}
                        {transferAtomic !== null && quotePending && <> · Estimating fee…</>}
                        {quoteQuery.isError && quoteAmount === transferAmount && (
                          <> · Fee unavailable: {quoteQuery.error.message}</>
                        )}
                        {transferExceedsBalance && (
                          <span className="text-red-500"> (Insufficient balance)</span>
                        )}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="recipient-address">
                        Recipient Address (optional)
                      </Label>
                      <Input
                        id="recipient-address"
                        type="text"
                        placeholder="Defaults to your Circle wallet"
                        className="w-full"
                        value={recipientAddress}
                        onChange={(e) => setRecipientAddress(e.target.value)}
                        disabled={transferLoading}
                      />
                    </div>
                    <Button
                      onClick={handleTransfer}
                      disabled={
                        transferLoading ||
                        !hasCircleWallet ||
                        transferAtomic === null ||
                        quotePending ||
                        transferExceedsBalance
                      }
                      className="w-full"
                    >
                      {transferLoading ? "Processing..." : "Transfer"}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* --- Funding Help Section --- */}
          <Card>
            <CardHeader>
              <CardTitle>Need Testnet USDC?</CardTitle>
              <CardDescription>
                Get funds to test cross-chain transfers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Alert>
                  <AlertCircleIcon className="h-4 w-4" />
                  <AlertTitle>Circle Faucet</AlertTitle>
                  <AlertDescription>
                    Visit the <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Circle Faucet</a> to get testnet USDC on Arc, Base Sepolia, and Avalanche Fuji.
                  </AlertDescription>
                </Alert>
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-2">Quick Steps:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Copy your Circle Wallet address from the Wallet Setup card</li>
                    <li>Visit the Circle Faucet and enter your wallet address</li>
                    <li>Select the desired testnet and request USDC</li>
                    <li>Wait for the transaction to confirm, then deposit to Gateway from that chain</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* --- Transaction History Table --- */}
          <TransactionHistory />
        </div>
      </div>
    </>
  );
}
