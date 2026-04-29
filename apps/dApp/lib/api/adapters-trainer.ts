import { getBackendUrl } from "@/lib/env";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import {
  isAdapterListResponse,
  type AdapterListItem,
} from "@/lib/types/adapter";

/**
 * İmzalı oturumla yalnızca bu cüzdanın adaptörleri — `GET /v1/me/adapters`.
 */
export async function fetchMyAdapters(
  auth: R3mesWalletAuthHeaders,
): Promise<AdapterListItem[]> {
  const base = getBackendUrl();
  const url = new URL("/v1/me/adapters", base);
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      "X-Signature": auth["X-Signature"],
      "X-Message": auth["X-Message"],
      "X-Wallet-Address": auth["X-Wallet-Address"],
    },
  });

  if (!res.ok) {
    throw new Error(`Adapters API ${res.status}`);
  }

  const json: unknown = await res.json();
  if (!isAdapterListResponse(json)) {
    return [];
  }

  return json.data;
}
