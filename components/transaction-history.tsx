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

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TransactionType = "deposit" | "transfer" | "unify";
type TransactionStatus = "pending" | "success" | "failed";

interface Transaction {
  id: string;
  user_id: string;
  chain: string;
  tx_type: TransactionType;
  amount: number;
  tx_hash: string | null;
  gateway_wallet_address: string | null;
  destination_chain: string | null;
  status: TransactionStatus;
  reason: string | null;
  created_at: string;
}

// Chain configuration for explorer links
const CHAIN_EXPLORERS: Record<string, string> = {
  arcTestnet: "https://explorer.testnet.arc.io/",
  baseSepolia: "https://sepolia.basescan.org/",
  avalancheFuji: "https://testnet.snowtrace.io/",
};

const CHAIN_NAMES: Record<string, string> = {
  arcTestnet: "Arc Testnet",
  baseSepolia: "Base Sepolia",
  avalancheFuji: "Avalanche Fuji",
};

type SortOrder = "none" | "asc" | "desc";

function SortIcon({ order }: { order: SortOrder }) {
  if (order === "asc") return <ArrowUp className="ml-2 h-4 w-4 inline" />;
  if (order === "desc") return <ArrowDown className="ml-2 h-4 w-4 inline" />;
  return <ArrowUpDown className="ml-2 h-4 w-4 inline" />;
}

export function TransactionHistory() {
  // Fetched in the browser only. The dashboard refreshes it after a deposit or transfer.
  const {
    data: transactions = [],
    isPending: loading,
    error,
  } = useQuery({
    queryKey: ["transactions"],
    queryFn: async (): Promise<Transaction[]> => {
      const response = await fetch("/api/transactions");
      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }
      return response.json();
    },
  });

  // Filter and sort state
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  // Filter and sort transactions
  const filteredAndSortedTransactions = useMemo(() => {
    const filtered = transactions.filter((tx) => {
      // Search filter (tx hash, chain, or destination chain)
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        !searchTerm ||
        tx.tx_hash?.toLowerCase().includes(searchLower) ||
        tx.chain.toLowerCase().includes(searchLower) ||
        tx.destination_chain?.toLowerCase().includes(searchLower);

      // Type filter
      const matchesType = typeFilter === "all" || tx.tx_type === typeFilter;

      // Status filter
      const matchesStatus =
        statusFilter === "all" || tx.status === statusFilter;

      return matchesSearch && matchesType && matchesStatus;
    });

    // Sort by date
    if (sortOrder !== "none") {
      filtered.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === "asc" ? dateA - dateB : dateB - dateA;
      });
    }

    return filtered;
  }, [transactions, searchTerm, typeFilter, statusFilter, sortOrder]);

  const totalPages = Math.ceil(
    filteredAndSortedTransactions.length / rowsPerPage
  );
  const paginatedTransactions = filteredAndSortedTransactions.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const handleSort = () => {
    if (sortOrder === "none") setSortOrder("desc");
    else if (sortOrder === "desc") setSortOrder("asc");
    else setSortOrder("none");
  };

  const getStatusBadge = (status: TransactionStatus) => {
    switch (status) {
      case "success":
        return (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
            Success
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="cursor-help">
            Failed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            Pending
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getExplorerLink = (tx: Transaction) => {
    // For transfers, the tx_hash is the mint transaction on the destination chain
    // For deposits, the tx_hash is on the source chain
    const chain = tx.tx_type === "transfer" && tx.destination_chain 
      ? tx.destination_chain 
      : tx.chain;
    
    const explorerBase = CHAIN_EXPLORERS[chain];
    if (!explorerBase || !tx.tx_hash) return null;
    return `${explorerBase}tx/${tx.tx_hash}`;
  };

  const formatChainName = (chain: string) => {
    return CHAIN_NAMES[chain] || chain;
  };

  const truncateHash = (hash: string) => {
    if (!hash) return "N/A";
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  // Changing a filter goes back to page 1
  const withPageReset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setCurrentPage(1);
    };

  return (
    <Card>
      
      <CardContent>
        <div className="space-y-4 mt-7">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <Input
              placeholder="Search by transaction hash"
              value={searchTerm}
              onChange={(e) => withPageReset(setSearchTerm)(e.target.value)}
              className="sm:max-w-xs"
            />
            <Select value={typeFilter} onValueChange={withPageReset(setTypeFilter)}>
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="deposit">Deposit</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="unify">Unify</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={withPageReset(setStatusFilter)}>
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Chain(s)</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaction Hash</TableHead>
                  <TableHead>
                    <Button variant="ghost" onClick={handleSort} className="h-8 p-0">
                      Date
                      <SortIcon order={sortOrder} />
                    </Button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-red-500">
                      Error: {error.message}
                    </TableCell>
                  </TableRow>
                ) : paginatedTransactions.length > 0 ? (
                  paginatedTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="capitalize font-medium">
                        {tx.tx_type}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{formatChainName(tx.chain)}</div>
                          {tx.destination_chain && (
                            <div className="text-muted-foreground text-xs">
                              → {formatChainName(tx.destination_chain)}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {tx.amount ? `${tx.amount.toFixed(2)} USDC` : "N/A"}
                      </TableCell>
                      <TableCell>
                        {/* 2. Updated Status Cell with Tooltip Logic */}
                        {tx.status === "failed" && tx.reason ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {getStatusBadge(tx.status)}
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-[300px] text-xs break-words">
                                  {tx.reason}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          getStatusBadge(tx.status)
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.tx_hash ? (
                          <a
                            href={getExplorerLink(tx) || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-mono text-xs"
                          >
                            {truncateHash(tx.tx_hash)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(tx.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No transactions found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 0 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * rowsPerPage + 1} to{" "}
                {Math.min(
                  currentPage * rowsPerPage,
                  filteredAndSortedTransactions.length
                )}{" "}
                of {filteredAndSortedTransactions.length} transactions
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}