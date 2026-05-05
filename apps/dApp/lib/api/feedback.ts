import { getBackendUrl } from "@/lib/env";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";

export type KnowledgeFeedbackKind =
  | "GOOD_SOURCE"
  | "WRONG_SOURCE"
  | "MISSING_SOURCE"
  | "BAD_ANSWER"
  | "GOOD_ANSWER";

export type KnowledgeFeedbackPayload = {
  kind: KnowledgeFeedbackKind;
  traceId?: string | null;
  query?: string | null;
  queryHash?: string | null;
  collectionId?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  expectedCollectionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

function authHeaders(auth: R3mesWalletAuthHeaders): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Signature": auth["X-Signature"],
    "X-Message": auth["X-Message"],
    "X-Wallet-Address": auth["X-Wallet-Address"],
  };
}

export async function postKnowledgeFeedback(
  payload: KnowledgeFeedbackPayload,
  auth: R3mesWalletAuthHeaders,
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/v1/feedback/knowledge`, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Feedback API ${res.status}`);
  }
}
