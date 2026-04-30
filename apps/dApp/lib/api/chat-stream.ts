import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import { getBackendUrl, getChatDebugEnabled, getOptionalChatModel } from "@/lib/env";
import type { ChatRetrievalDebug, ChatSourceCitation } from "@/lib/types/knowledge";
import { userFacingHttpMessage } from "@/lib/ui/http-messages";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

function readRetrievalDebug(response: unknown): ChatRetrievalDebug | null {
  const parsed = response as { retrieval_debug?: unknown };
  return parsed.retrieval_debug && typeof parsed.retrieval_debug === "object"
    ? (parsed.retrieval_debug as ChatRetrievalDebug)
    : null;
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

/**
 * POST /v1/chat/completions — backend proxy; `adapter_id` (DB id) veya `adapter_cid` ile
 * çözüm sunucuda yapılır (INTEGRATION_CONTRACT §3.5).
 */
export async function* streamChatCompletions(params: {
  messages: ChatMessage[];
  adapterId?: string;
  adapterCid?: string;
  collectionIds?: string[];
  includePublic?: boolean;
  auth: R3mesWalletAuthHeaders;
  onSources?: (sources: ChatSourceCitation[]) => void;
  onRetrievalDebug?: (debug: ChatRetrievalDebug) => void;
  signal?: AbortSignal;
}): AsyncGenerator<string, void, unknown> {
  const base = getBackendUrl();
  const url = new URL("/v1/chat/completions", base);

  const body: Record<string, unknown> = {
    messages: params.messages,
    // The current backend/ai-engine streaming path can hang while waiting for
    // upstream headers. Use the stable non-stream path and yield once so the UI
    // contract stays unchanged.
    stream: false,
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
    const debug = readRetrievalDebug(parsed);
    if (debug) params.onRetrievalDebug?.(debug);
    const content = readAssistantContent(parsed);
    if (content) yield content;
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
