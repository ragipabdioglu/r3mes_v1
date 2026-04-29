import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";

const STORAGE_PREFIX = "r3mes.auth.v1:";

export type CachedWalletAuth = {
  message: string;
  signature: string;
  walletAddress: string;
  expiresAt: number;
};

function keyForWallet(wallet: string): string {
  return `${STORAGE_PREFIX}${wallet.toLowerCase()}`;
}

export function readCachedWalletAuth(
  wallet: string,
): CachedWalletAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyForWallet(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWalletAuth;
    if (
      typeof parsed.message !== "string" ||
      typeof parsed.signature !== "string" ||
      typeof parsed.walletAddress !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      localStorage.removeItem(keyForWallet(wallet));
      return null;
    }
    if (parsed.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(keyForWallet(wallet));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedWalletAuth(
  wallet: string,
  payload: {
    message: string;
    signature: string;
    ttlMs: number;
  },
): void {
  if (typeof window === "undefined") return;
  const entry: CachedWalletAuth = {
    message: payload.message,
    signature: payload.signature,
    walletAddress: wallet,
    expiresAt: Date.now() + payload.ttlMs,
  };
  localStorage.setItem(keyForWallet(wallet), JSON.stringify(entry));
}

export function clearCachedWalletAuth(wallet: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyForWallet(wallet));
}

export function cachedAuthToHeaders(
  cached: CachedWalletAuth,
): R3mesWalletAuthHeaders {
  return {
    "X-Signature": cached.signature,
    "X-Message": cached.message,
    "X-Wallet-Address": cached.walletAddress,
  };
}
