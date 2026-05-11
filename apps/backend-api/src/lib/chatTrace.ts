import { createHash, randomUUID } from "node:crypto";

export type ChatTraceStageName =
  | "request"
  | "source_access"
  | "query_understanding"
  | "query_planning"
  | "retrieval"
  | "suggestion_probe"
  | "source_selection"
  | "answer_path"
  | "ai_engine"
  | "validator"
  | "render_safety";

export type ChatTraceStageStatus = "ok" | "skipped" | "error";

export interface ChatTraceStageHandle {
  name: ChatTraceStageName;
  startedAt: string;
  startedMs: number;
}

export interface ChatTraceStage {
  name: ChatTraceStageName;
  startedAt: string;
  durationMs: number;
  status: ChatTraceStageStatus;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface ChatTraceSnapshot {
  traceId: string;
  startedAt: string;
  totalDurationMs: number;
  query: {
    hash: string;
    length: number;
  };
  request: {
    stream: boolean;
    includePublic: boolean;
    requestedCollectionCount: number;
  };
  route?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
  sourceSelection?: Record<string, unknown>;
  answerPath?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  stages: ChatTraceStage[];
}

function hashQuery(query: string): string {
  return createHash("sha256").update(query.trim(), "utf8").digest("hex").slice(0, 16);
}

function cleanDetail(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined));
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class ChatTraceBuilder {
  private readonly traceId = randomUUID();
  private readonly startedAt = new Date().toISOString();
  private readonly startedMs = Date.now();
  private readonly stages: ChatTraceStage[] = [];
  private readonly queryHash: string;
  private readonly queryLength: number;

  constructor(private readonly request: ChatTraceSnapshot["request"] & { query: string }) {
    this.queryHash = hashQuery(request.query);
    this.queryLength = request.query.trim().length;
  }

  start(name: ChatTraceStageName): ChatTraceStageHandle {
    return {
      name,
      startedAt: new Date().toISOString(),
      startedMs: Date.now(),
    };
  }

  finish(
    handle: ChatTraceStageHandle,
    status: ChatTraceStageStatus,
    detail?: Record<string, unknown>,
    error?: unknown,
  ): void {
    this.stages.push({
      name: handle.name,
      startedAt: handle.startedAt,
      durationMs: Math.max(0, Date.now() - handle.startedMs),
      status,
      detail: cleanDetail(detail),
      error: error == null ? undefined : errorToMessage(error),
    });
  }

  recordNow(name: ChatTraceStageName, status: ChatTraceStageStatus, detail?: Record<string, unknown>): void {
    const handle = this.start(name);
    this.finish(handle, status, detail);
  }

  snapshot(extra: Partial<Omit<ChatTraceSnapshot, "traceId" | "startedAt" | "totalDurationMs" | "query" | "request" | "stages">> = {}): ChatTraceSnapshot {
    return {
      traceId: this.traceId,
      startedAt: this.startedAt,
      totalDurationMs: Math.max(0, Date.now() - this.startedMs),
      query: {
        hash: this.queryHash,
        length: this.queryLength,
      },
      request: {
        stream: this.request.stream,
        includePublic: this.request.includePublic,
        requestedCollectionCount: this.request.requestedCollectionCount,
      },
      ...extra,
      stages: [...this.stages],
    };
  }
}

export function createChatTrace(opts: ChatTraceSnapshot["request"] & { query: string }): ChatTraceBuilder {
  return new ChatTraceBuilder(opts);
}
