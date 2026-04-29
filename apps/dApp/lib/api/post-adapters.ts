import { getBackendUrl } from "@/lib/env";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";

/**
 * Multipart adaptör yükleme — imza başlıkları zorunlu (Faz 8.3).
 * Content-Type boundary tarayıcı tarafından ayarlanır; yalnızca X-* eklenir.
 */
export async function postAdaptersMultipart(
  formData: FormData,
  auth: R3mesWalletAuthHeaders,
): Promise<Response> {
  const base = getBackendUrl();
  return fetch(`${base}/v1/adapters`, {
    method: "POST",
    headers: {
      "X-Signature": auth["X-Signature"],
      "X-Message": auth["X-Message"],
      "X-Wallet-Address": auth["X-Wallet-Address"],
    },
    body: formData,
  });
}
