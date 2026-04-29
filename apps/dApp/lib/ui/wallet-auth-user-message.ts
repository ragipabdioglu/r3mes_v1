import { auth } from "@/lib/ui/product-copy";

/**
 * Cüzdan / imza akışından gelen hatalar — backend gövdesi değildir.
 */
export function userFacingWalletAuthError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes("cüzdan") ||
    lower.includes("wallet") ||
    lower.includes("bağlantı")
  ) {
    return auth.walletRequired;
  }
  if (
    /reject|iptal|denied|cancel|declined|user denied|user rejected|rejected the request/i.test(
      msg,
    )
  ) {
    return auth.signCancelled;
  }
  return auth.signFailed;
}

export function isLikelyWalletAuthFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /cüzdan|wallet|reject|iptal|denied|cancel|declined|signature|imza/i.test(
    msg,
  );
}
