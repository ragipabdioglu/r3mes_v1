const CHAT_DEBUG_RESPONSE_KEYS = [
  "grounded_answer",
  "safety_gate",
  "answer_quality",
  "retrieval_debug",
  "chat_trace",
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
