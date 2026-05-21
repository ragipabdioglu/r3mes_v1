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
  "evidenceSignals",
  "retrieval_debug",
  "retrievalDebug",
  "chat_trace",
  "chatTrace",
  "runtime_lineage",
  "runtimeLineage",
] as const;

export type ChatDebugResponseKey = typeof CHAT_DEBUG_RESPONSE_KEYS[number];

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
