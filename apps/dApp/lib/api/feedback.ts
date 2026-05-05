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

export type KnowledgeFeedbackProposalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type KnowledgeFeedbackProposalAction =
  | "BOOST_SOURCE"
  | "PENALIZE_SOURCE"
  | "REVIEW_MISSING_SOURCE"
  | "REVIEW_ANSWER_QUALITY";

export type KnowledgeFeedbackProposalItem = {
  id: string;
  action: KnowledgeFeedbackProposalAction;
  status: KnowledgeFeedbackProposalStatus;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  confidence: number;
  reason: string;
  evidence: Record<string, unknown>;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeFeedbackAggregateItem = {
  key: string;
  collectionId: string | null;
  expectedCollectionId: string | null;
  queryHash: string | null;
  total: number;
  goodSourceCount: number;
  wrongSourceCount: number;
  missingSourceCount: number;
  badAnswerCount: number;
  goodAnswerCount: number;
  negativeRate: number;
  suggestedAction: KnowledgeFeedbackProposalAction | null;
};

export type KnowledgeFeedbackSummaryResponse = {
  data: KnowledgeFeedbackAggregateItem[];
  totalFeedback: number;
  generatedAt: string;
};

export type KnowledgeFeedbackProposalImpactResponse = {
  proposal: KnowledgeFeedbackProposalItem;
  impact: {
    proposalId: string;
    action: KnowledgeFeedbackProposalAction;
    targetCollectionId: string | null;
    expectedCollectionId: string | null;
    queryHash: string | null;
    estimatedScoreDelta: number;
    riskLevel: "low" | "medium" | "high";
    wouldAutoApply: false;
    rationale: string[];
  };
  nextSafeAction: "review_only" | "run_eval_before_apply" | "needs_more_feedback";
};

export type KnowledgeFeedbackApplyPlanResponse = {
  proposal: KnowledgeFeedbackProposalItem;
  impact: KnowledgeFeedbackProposalImpactResponse["impact"];
  steps: Array<{
    id: string;
    kind:
      | "BOOST_COLLECTION_SCORE"
      | "PENALIZE_COLLECTION_SCORE"
      | "CREATE_MISSING_SOURCE_REVIEW"
      | "CREATE_ANSWER_QUALITY_EVAL";
    targetCollectionId: string | null;
    expectedCollectionId: string | null;
    queryHash: string | null;
    scoreDelta: number;
    reversible: true;
    rollback: string;
    rationale: string;
  }>;
  mutationEnabled: false;
  applyAllowed: false;
  requiredGate: "feedback_eval_gate";
  blockedReasons: string[];
};

export type KnowledgeFeedbackApplyRecordStatus =
  | "PLANNED"
  | "GATE_PASSED"
  | "APPLIED"
  | "ROLLED_BACK"
  | "BLOCKED";

export type KnowledgeFeedbackApplyRecordItem = {
  id: string;
  proposalId: string;
  status: KnowledgeFeedbackApplyRecordStatus;
  plan: KnowledgeFeedbackApplyPlanResponse;
  reason: string | null;
  plannedAt: string;
  gateCheckedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeFeedbackApplyRecordListResponse = {
  data: KnowledgeFeedbackApplyRecordItem[];
  total: number;
  generatedAt: string;
};

export type KnowledgeFeedbackApplyRecordCreateResponse = {
  record: KnowledgeFeedbackApplyRecordItem;
  mutationApplied: false;
  nextSafeAction: "run_feedback_eval_gate";
};

function authHeaders(auth: R3mesWalletAuthHeaders): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Signature": auth["X-Signature"],
    "X-Message": auth["X-Message"],
    "X-Wallet-Address": auth["X-Wallet-Address"],
  };
}

export async function fetchKnowledgeFeedbackSummary(
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackSummaryResponse> {
  const url = new URL("/v1/feedback/knowledge/summary", getBackendUrl());
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: authHeaders(auth),
  });
  if (!res.ok) throw new Error(`Feedback summary ${res.status}`);
  return (await res.json()) as KnowledgeFeedbackSummaryResponse;
}

export async function fetchKnowledgeFeedbackProposals(
  auth: R3mesWalletAuthHeaders,
  status: KnowledgeFeedbackProposalStatus | "all" = "PENDING",
): Promise<KnowledgeFeedbackProposalItem[]> {
  const url = new URL("/v1/feedback/knowledge/proposals", getBackendUrl());
  url.searchParams.set("limit", "50");
  if (status !== "all") url.searchParams.set("status", status);
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: authHeaders(auth),
  });
  if (!res.ok) throw new Error(`Feedback proposals ${res.status}`);
  const json = (await res.json()) as { data?: KnowledgeFeedbackProposalItem[] };
  return Array.isArray(json.data) ? json.data : [];
}

export async function generateKnowledgeFeedbackProposals(
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackProposalItem[]> {
  const res = await fetch(`${getBackendUrl()}/v1/feedback/knowledge/proposals/generate`, {
    method: "POST",
    headers: authHeaders(auth),
  });
  if (!res.ok) throw new Error(`Feedback proposal generate ${res.status}`);
  const json = (await res.json()) as { data?: KnowledgeFeedbackProposalItem[] };
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchKnowledgeFeedbackProposalImpact(
  proposalId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackProposalImpactResponse> {
  const res = await fetch(
    `${getBackendUrl()}/v1/feedback/knowledge/proposals/${encodeURIComponent(proposalId)}/impact`,
    {
      cache: "no-store",
      headers: authHeaders(auth),
    },
  );
  if (!res.ok) throw new Error(`Feedback proposal impact ${res.status}`);
  return (await res.json()) as KnowledgeFeedbackProposalImpactResponse;
}

export async function fetchKnowledgeFeedbackApplyPlan(
  proposalId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackApplyPlanResponse> {
  const res = await fetch(
    `${getBackendUrl()}/v1/feedback/knowledge/proposals/${encodeURIComponent(proposalId)}/apply-plan`,
    {
      cache: "no-store",
      headers: authHeaders(auth),
    },
  );
  if (!res.ok) throw new Error(`Feedback apply plan ${res.status}`);
  return (await res.json()) as KnowledgeFeedbackApplyPlanResponse;
}

export async function fetchKnowledgeFeedbackApplyRecords(
  auth: R3mesWalletAuthHeaders,
  status: KnowledgeFeedbackApplyRecordStatus | "all" = "all",
): Promise<KnowledgeFeedbackApplyRecordListResponse> {
  const url = new URL("/v1/feedback/knowledge/apply-records", getBackendUrl());
  url.searchParams.set("limit", "25");
  if (status !== "all") url.searchParams.set("status", status);
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: authHeaders(auth),
  });
  if (!res.ok) throw new Error(`Feedback apply records ${res.status}`);
  return (await res.json()) as KnowledgeFeedbackApplyRecordListResponse;
}

export async function createKnowledgeFeedbackApplyRecord(
  proposalId: string,
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackApplyRecordCreateResponse> {
  const res = await fetch(
    `${getBackendUrl()}/v1/feedback/knowledge/proposals/${encodeURIComponent(proposalId)}/apply-records`,
    {
      method: "POST",
      headers: authHeaders(auth),
    },
  );
  if (!res.ok) throw new Error(`Feedback apply record create ${res.status}`);
  return (await res.json()) as KnowledgeFeedbackApplyRecordCreateResponse;
}

export async function reviewKnowledgeFeedbackProposal(
  proposalId: string,
  decision: "approve" | "reject",
  auth: R3mesWalletAuthHeaders,
): Promise<KnowledgeFeedbackProposalItem> {
  const res = await fetch(
    `${getBackendUrl()}/v1/feedback/knowledge/proposals/${encodeURIComponent(proposalId)}/${decision}`,
    {
      method: "POST",
      headers: authHeaders(auth),
    },
  );
  if (!res.ok) throw new Error(`Feedback proposal review ${res.status}`);
  const json = (await res.json()) as { proposal: KnowledgeFeedbackProposalItem };
  return json.proposal;
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
