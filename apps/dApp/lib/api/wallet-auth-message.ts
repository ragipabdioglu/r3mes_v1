import { getWalletAuthRequireJti } from "@/lib/env";

/** İmzalanacak payload (UTF-8 JSON string). */
export function buildR3mesAuthMessage(
  walletAddress: string,
  ttlMs: number = 900_000,
): string {
  const now = Date.now();
  const payload: Record<string, string | number> = {
    exp: Math.floor((now + ttlMs) / 1000),
    iat: Math.floor(now / 1000),
    address: walletAddress,
  };
  if (getWalletAuthRequireJti()) {
    payload.jti = crypto.randomUUID();
  }
  return JSON.stringify(payload);
}
