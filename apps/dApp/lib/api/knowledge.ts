import { getBackendUrl } from "@/lib/env";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import {
  isKnowledgeCollectionDetail,
  isKnowledgeCollectionListResponse,
  type KnowledgeCollectionDetail,
  type KnowledgeCollectionListItem,
  type KnowledgeUploadAcceptedResponse,
  type KnowledgeVisibilityMutationResponse,
} from "@/lib/types/knowledge";

function authHeaders(auth: R3mesWalletAuthHeaders): Record<string, string> {
  return {
    "X-Signature": auth["X-Signature"],
    "X-Message": auth["X-Message"],
    "X-Wallet-Address": auth["X-Wallet-Address"],
  };
}

export async function fetchKnowledgeCollections(
  auth: R3mesWalletAuthHeaders,
  scope: "mine" | "public" | "all" = "mine",
): Promise<KnowledgeCollectionListItem[]> {
  const url = new URL("/v1/knowledge", getBackendUrl());
  url.searchParams.set("limit", "100");
  url.searchParams.set("scope", scope);

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: authHeaders(auth),
  });

  if (!res.ok) {
    throw new Error(`Knowledge API ${res.status}`);
  }

  const json: unknown = await res.json();
  if (!isKnowledgeCollectionListResponse(json)) {
    return [];
  }
  return json.data;
}

export async function fetchKnowledgeCollectionDetail(
  collectionId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeCollectionDetail | null> {
  const res = await fetch(
    `${getBackendUrl()}/v1/knowledge/${encodeURIComponent(collectionId)}`,
    {
      cache: "no-store",
      headers: authHeaders(auth),
    },
  );

  if (!res.ok) {
    throw new Error(`Knowledge detail ${res.status}`);
  }

  const json: unknown = await res.json();
  return isKnowledgeCollectionDetail(json) ? json : null;
}

export async function postKnowledgeMultipart(
  formData: FormData,
  auth: R3mesWalletAuthHeaders,
): Promise<Response> {
  return fetch(`${getBackendUrl()}/v1/knowledge/upload`, {
    method: "POST",
    headers: authHeaders(auth),
    body: formData,
  });
}

export async function publishKnowledgeCollection(
  collectionId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeVisibilityMutationResponse> {
  const res = await fetch(
    `${getBackendUrl()}/v1/knowledge/${encodeURIComponent(collectionId)}/publish`,
    {
      method: "POST",
      headers: authHeaders(auth),
    },
  );

  if (!res.ok) {
    throw new Error(`Knowledge publish ${res.status}`);
  }

  return (await res.json()) as KnowledgeVisibilityMutationResponse;
}

export async function unpublishKnowledgeCollection(
  collectionId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeVisibilityMutationResponse> {
  const res = await fetch(
    `${getBackendUrl()}/v1/knowledge/${encodeURIComponent(collectionId)}/unpublish`,
    {
      method: "POST",
      headers: authHeaders(auth),
    },
  );

  if (!res.ok) {
    throw new Error(`Knowledge unpublish ${res.status}`);
  }

  return (await res.json()) as KnowledgeVisibilityMutationResponse;
}
