"use client";

import { useCurrentAccount, useSignPersonalMessage } from "@mysten/dapp-kit";
import { useCallback, useMemo } from "react";

import { buildR3mesAuthMessage } from "@/lib/api/wallet-auth-message";
import { getAuthTtlMs, getWalletAuthRequireJti } from "@/lib/env";
import { auth } from "@/lib/ui/product-copy";
import {
  cachedAuthToHeaders,
  clearCachedWalletAuth,
  readCachedWalletAuth,
  writeCachedWalletAuth,
} from "@/lib/api/wallet-auth-cache";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";

export function useR3mesWalletAuth() {
  const account = useCurrentAccount();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const ttlMs = useMemo(() => getAuthTtlMs(), []);

  const ensureAuthHeaders = useCallback(
    async (options?: { forceRefresh?: boolean }): Promise<R3mesWalletAuthHeaders> => {
      const addr = account?.address;
      if (!addr) {
        throw new Error(auth.walletRequired);
      }

      if (!options?.forceRefresh && !getWalletAuthRequireJti()) {
        const hit = readCachedWalletAuth(addr);
        if (hit) return cachedAuthToHeaders(hit);
      } else {
        clearCachedWalletAuth(addr);
      }

      const message = buildR3mesAuthMessage(addr, ttlMs);
      const messageBytes = new TextEncoder().encode(message);
      const result = await signPersonalMessage({ message: messageBytes });

      writeCachedWalletAuth(addr, {
        message,
        signature: result.signature,
        ttlMs,
      });

      return {
        "X-Signature": result.signature,
        "X-Message": message,
        "X-Wallet-Address": addr,
      };
    },
    [account?.address, signPersonalMessage, ttlMs],
  );

  const clearAuthCache = useCallback(() => {
    const addr = account?.address;
    if (addr) clearCachedWalletAuth(addr);
  }, [account?.address]);

  return {
    ensureAuthHeaders,
    clearAuthCache,
    walletAddress: account?.address,
  };
}
