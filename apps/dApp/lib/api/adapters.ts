import { getBackendUrl } from "@/lib/env";
import { MARKETPLACE_ADAPTER_QUERY_STATUS } from "@/lib/ui/r3mes-fe-contract";
import {
  isAdapterListResponse,
  sortAdaptersByBenchmark,
  type AdapterListItem,
} from "@/lib/types/adapter";

/** GET /v1/adapters?status=… — yalnızca ACTIVE; PENDING_REVIEW pazaryerinde listelenmez (@/lib/ui/r3mes-fe-contract) */
export async function fetchActiveAdaptersSorted(): Promise<AdapterListItem[]> {
  const base = getBackendUrl();
  const url = new URL("/v1/adapters", base);
  url.searchParams.set("status", MARKETPLACE_ADAPTER_QUERY_STATUS);

  const res = await fetch(url.toString(), {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Adapters API ${res.status}: ${res.statusText}`);
  }

  const json: unknown = await res.json();
  if (!isAdapterListResponse(json)) {
    return [];
  }

  return sortAdaptersByBenchmark(json.data);
}
