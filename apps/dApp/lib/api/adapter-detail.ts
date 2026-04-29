import { getBackendUrl } from "@/lib/env";

export type AdapterChatMetadata = {
  domainTags: string[];
  format?: string;
  runtime?: string;
  name?: string;
};

/** Sohbet üzerinde dev test ibaresi için — yalnızca `domainTags` okunur. */
export async function fetchAdapterDomainTags(
  id: string,
): Promise<string[] | null> {
  const metadata = await fetchAdapterChatMetadata(id);
  return metadata?.domainTags ?? null;
}

export async function fetchAdapterChatMetadata(
  id: string,
): Promise<AdapterChatMetadata | null> {
  const base = getBackendUrl();
  const res = await fetch(
    `${base}/v1/adapters/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const j: unknown = await res.json();
  if (!j || typeof j !== "object") return null;
  const adapter = j as {
    domainTags?: unknown;
    format?: unknown;
    runtime?: unknown;
    name?: unknown;
  };
  const domainTags = Array.isArray(adapter.domainTags)
    ? adapter.domainTags.filter((x): x is string => typeof x === "string")
    : [];
  return {
    domainTags,
    format: typeof adapter.format === "string" ? adapter.format : undefined,
    runtime: typeof adapter.runtime === "string" ? adapter.runtime : undefined,
    name: typeof adapter.name === "string" ? adapter.name : undefined,
  };
}
