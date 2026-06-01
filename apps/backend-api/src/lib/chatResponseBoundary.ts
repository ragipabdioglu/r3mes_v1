const CHAT_DEBUG_RESPONSE_KEYS = [
  "debug_contract_version",
  "debugContractVersion",
  "eval_debug_contract",
  "evalDebugContract",
  "grounded_answer",
  "answer_plan",
  "answerPlan",
  "safety_gate",
  "safetyGate",
  "answer_quality",
  "answerQuality",
  "answer_baseline",
  "answerBaseline",
  "evidenceSignals",
  "retrieval_debug",
  "retrievalDebug",
  "chat_trace",
  "chatTrace",
  "runtime_lineage",
  "runtimeLineage",
] as const;

const PUBLIC_CHAT_RESPONSE_V2_KEYS = [
  "version",
  "answer",
  "sources",
  "suggestions",
  "status",
] as const;

export type ChatDebugResponseKey = typeof CHAT_DEBUG_RESPONSE_KEYS[number];
export type PublicChatResponseV2Key = typeof PUBLIC_CHAT_RESPONSE_V2_KEYS[number];

export function stripChatDebugFields<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  for (const key of CHAT_DEBUG_RESPONSE_KEYS) {
    delete next[key];
  }
  return next;
}

export function chatDebugResponseKeys(): ChatDebugResponseKey[] {
  return [...CHAT_DEBUG_RESPONSE_KEYS];
}

export function publicChatResponseV2Keys(): PublicChatResponseV2Key[] {
  return [...PUBLIC_CHAT_RESPONSE_V2_KEYS];
}

export function hasChatDebugField(payload: Record<string, unknown>): boolean {
  return CHAT_DEBUG_RESPONSE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}
