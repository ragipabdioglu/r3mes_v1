"use client";

import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider as MystenWalletProvider,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { getSuiNetwork } from "@/lib/env";

const { networkConfig } = createNetworkConfig({
  localnet: {
    url: getJsonRpcFullnodeUrl("localnet"),
    network: "localnet",
  },
  devnet: {
    url: getJsonRpcFullnodeUrl("devnet"),
    network: "devnet",
  },
  testnet: {
    url: getJsonRpcFullnodeUrl("testnet"),
    network: "testnet",
  },
  mainnet: {
    url: getJsonRpcFullnodeUrl("mainnet"),
    network: "mainnet",
  },
});

export type WalletProviderProps = {
  children: ReactNode;
};

/**
 * Query + Sui RPC + Mysten WalletProvider: tek giriş noktası (cüzdan bağlama).
 */
export function WalletProvider({ children }: WalletProviderProps) {
  const [queryClient] = useState(() => new QueryClient());
  const network = getSuiNetwork();

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={network}>
        <MystenWalletProvider autoConnect theme={null}>
          {children}
        </MystenWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
