import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import {
  type ChatTransportProductMode,
  getBackendUrl,
  getChatDebugEnabled,
  getChatTransportProductMode,
  getOptionalChatModel,
} from "@/lib/env";
import type {
  ChatRetrievalDebug,
  ChatRuntimeLineageSummary,
  ChatSourceCitation,
  ChatSourceSuggestion,
  ChatUserFacingStatus,
} from "@/lib/types/knowledge";
import { userFacingHttpMessage } from "@/lib/ui/http-messages";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatTraceSummary = {
  traceId?: string;
  query?: {
    hash?: string;
  };
  runtimeLineage?: ChatRuntimeLineageSummary;
};

function readAssistantContent(response: unknown): string {
  const parsed = response as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = parsed.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function readSources(response: unknown): ChatSourceCitation[] {
  const parsed = response as { sources?: unknown };
  return Array.isArray(parsed.sources) ? (parsed.sources as ChatSourceCitation[]) : [];
}

function readSuggestions(response: unknown): ChatSourceSuggestion[] {
  const parsed = response as { suggestions?: unknown };
  return Array.isArray(parsed.suggestions) ? (parsed.suggestions as ChatSourceSuggestion[]) : [];
}

function readUserFacingStatus(response: unknown): ChatUserFacingStatus | undefined {
  const parsed = response as { status?: unknown };
  return parsed.status && typeof parsed.status === "object"
    ? (parsed.status as ChatUserFacingStatus)
    : undefined;
}

function readRetrievalDebug(response: unknown): ChatRetrievalDebug | null {
  const parsed = response as { retrieval_debug?: unknown };
  return parsed.retrieval_debug && typeof parsed.retrieval_debug === "object"
    ? (parsed.retrieval_debug as ChatRetrievalDebug)
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNestedRecord(input: Record<string, unknown>, path: string[]): Record<string, unknown> {
  return path.reduce<Record<string, unknown>>((current, key) => asRecord(current[key]), input);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function answerPathCallsQwen(answerPathName?: string): boolean | undefined {
  if (!answerPathName) return undefined;
  return answerPathName.startsWith("ai_engine") || answerPathName === "ai_engine";
}

function stageWasCalled(trace: Record<string, unknown>, stageName: string): boolean | undefined {
  const stages = trace.stages;
  if (!Array.isArray(stages)) return undefined;
  return stages.some((stage) => {
    const item = asRecord(stage);
    return item.name === stageName && item.status !== "skipped";
  });
}

export function summarizeChatTraceRuntimeLineage(
  trace: Record<string, unknown>,
): ChatRuntimeLineageSummary | undefined {
  const explicit = asRecord(trace.runtimeLineage);
  const qwen = asRecord(explicit.qwen);
  const embedding = asRecord(explicit.embedding);
  const reranker = asRecord(explicit.reranker);
  const explicitAnswerPath = asRecord(explicit.answerPath);
  const answerPath = asRecord(trace.answerPath);
  const runtime = {
    ...readNestedRecord(trace, ["retrieval", "runtime"]),
    ...asRecord(trace.runtime),
  };
  const answerPathName =
    readString(explicit.answerPathName) ??
    readString(explicit.answerPath) ??
    readString(explicitAnswerPath.name) ??
    readString(answerPath.name);
  const summary: ChatRuntimeLineageSummary = {
    answerPathName,
    qwenCalled:
      readBoolean(explicit.qwenCalled) ??
      readBoolean(qwen.called) ??
      stageWasCalled(trace, "ai_engine") ??
      answerPathCallsQwen(answerPathName),
    validatorCalled:
      readBoolean(explicit.validatorCalled) ??
      readBoolean(qwen.validatorCalled) ??
      stageWasCalled(trace, "validator"),
    embeddingFallbackUsed:
      readBoolean(explicit.embeddingFallbackUsed) ??
      readBoolean(embedding.fallbackUsed) ??
      readBoolean(runtime.embeddingFallbackUsed),
    rerankerFallbackUsed:
      readBoolean(explicit.rerankerFallbackUsed) ??
      readBoolean(reranker.fallbackUsed) ??
      readBoolean(runtime.rerankerFallbackUsed),
    runtimeProfileName:
      readString(explicit.runtimeProfileName) ??
      readString(explicit.profileName) ??
      readString(runtime.runtimeProfileName) ??
      readString(runtime.profileName) ??
      readString(asRecord(trace.runtimeProfile).name),
  };
  const hasLineage = Object.values(summary).some((value) => value !== undefined);
  return hasLineage ? summary : undefined;
}

function readChatTrace(response: unknown): ChatTraceSummary | null {
  const parsed = response as { chat_trace?: unknown; runtime_lineage?: unknown; runtimeLineage?: unknown };
  const trace = asRecord(parsed.chat_trace);
  const explicitRuntimeLineage = trace.runtimeLineage ?? parsed.runtimeLineage ?? parsed.runtime_lineage;
  const runtimeLineage =
    summarizeChatTraceRuntimeLineage({ runtimeLineage: explicitRuntimeLineage }) ??
    summarizeChatTraceRuntimeLineage(trace);
  if (typeof trace.traceId !== "string") {
    return runtimeLineage ? { runtimeLineage } : null;
  }
  return {
    ...(trace as ChatTraceSummary),
    runtimeLineage,
  };
}

function decodeSourcesHeader(value: string | null): ChatSourceCitation[] {
  if (!value) return [];
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder("utf-8").decode(bytes);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ChatSourceCitation[]) : [];
  } catch {
    return [];
  }
}

function readPositiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getTypewriterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_R3MES_TYPEWRITER_STREAM !== "0";
}

function getTypewriterChunkChars(): number {
  return readPositiveIntegerEnv("NEXT_PUBLIC_R3MES_TYPEWRITER_CHUNK_CHARS", 14, 4, 80);
}

function getTypewriterDelayMs(): number {
  return readPositiveIntegerEnv("NEXT_PUBLIC_R3MES_TYPEWRITER_DELAY_MS", 22, 0, 250);
}

function shouldRequestBackendStream(productMode: ChatTransportProductMode): false {
  switch (productMode) {
    case "non_stream_json":
      return false;
  }
}

function waitForTypewriterDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function splitTypewriterChunks(text: string, maxChars: number): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const token of tokens) {
    if (current && current.length + token.length > maxChars) {
      chunks.push(current);
      current = token;
      continue;
    }
    current += token;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function* yieldTypewriterText(text: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  if (!getTypewriterEnabled()) {
    yield text;
    return;
  }

  const chunks = splitTypewriterChunks(text, getTypewriterChunkChars());
  const delayMs = getTypewriterDelayMs();

  for (let index = 0; index < chunks.length; index += 1) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    yield chunks[index];
    if (index < chunks.length - 1) {
      await waitForTypewriterDelay(delayMs, signal);
    }
  }
}

/**
 * POST /v1/chat/completions — product chat uses non-stream JSON from backend.
 * This remains an async generator only to drive the local typewriter UX.
 */
export async function* streamChatCompletions(params: {
  messages: ChatMessage[];
  adapterId?: string;
  adapterCid?: string;
  collectionIds?: string[];
  includePublic?: boolean;
  auth: R3mesWalletAuthHeaders;
  onSources?: (sources: ChatSourceCitation[]) => void;
  onSuggestions?: (suggestions: ChatSourceSuggestion[]) => void;
  onStatus?: (status: ChatUserFacingStatus) => void;
  onRetrievalDebug?: (debug: ChatRetrievalDebug) => void;
  onChatTrace?: (trace: ChatTraceSummary) => void;
  signal?: AbortSignal;
}): AsyncGenerator<string, void, unknown> {
  const base = getBackendUrl();
  const url = new URL("/v1/chat/completions", base);
  const productMode = getChatTransportProductMode();

  const body: Record<string, unknown> = {
    messages: params.messages,
    // Product contract: backend returns one JSON response; UI may type it out locally.
    stream: shouldRequestBackendStream(productMode),
  };

  const model = getOptionalChatModel();
  if (model) body.model = model;

  if (params.adapterId) body.adapterId = params.adapterId;
  if (params.adapterCid) body.adapter_cid = params.adapterCid;
  if (params.collectionIds?.length) body.collectionIds = params.collectionIds;
  if (typeof params.includePublic === "boolean") {
    body.includePublic = params.includePublic;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Signature": params.auth["X-Signature"],
    "X-Message": params.auth["X-Message"],
    "X-Wallet-Address": params.auth["X-Wallet-Address"],
  };
  if (getChatDebugEnabled()) {
    headers["X-R3MES-Debug"] = "1";
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(userFacingHttpMessage(res.status, errText, "chat"));
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await res.json();
    const sources = readSources(parsed);
    if (sources.length > 0) params.onSources?.(sources);
    const suggestions = readSuggestions(parsed);
    params.onSuggestions?.(suggestions);
    const status = readUserFacingStatus(parsed);
    if (status) params.onStatus?.(status);
    const debug = readRetrievalDebug(parsed);
    if (debug) params.onRetrievalDebug?.(debug);
    const trace = readChatTrace(parsed);
    if (trace) params.onChatTrace?.(trace);
    const content = readAssistantContent(parsed);
    if (content) {
      yield* yieldTypewriterText(content, params.signal);
    }
    return;
  }

  const headerSources = decodeSourcesHeader(res.headers.get("x-r3mes-sources"));
  if (headerSources.length > 0) params.onSources?.(headerSources);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (params.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            sources?: ChatSourceCitation[];
          };
          if (Array.isArray(json.sources)) {
            params.onSources?.(json.sources);
          }
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        } catch {
          /* satır tam JSON değilse yoksay */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
