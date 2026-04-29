export type ChatRuntime = "llama_cpp" | "transformers_peft";

const DEFAULT_RUNTIME: ChatRuntime = "llama_cpp";

export function getConfiguredChatRuntime(): ChatRuntime {
  const raw = (process.env.R3MES_AI_RUNTIME ?? process.env.R3MES_INFERENCE_BACKEND ?? "").trim();
  if (raw === "transformers_peft" || raw === "llama_cpp") return raw;
  return DEFAULT_RUNTIME;
}

export function normalizeAdapterPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
