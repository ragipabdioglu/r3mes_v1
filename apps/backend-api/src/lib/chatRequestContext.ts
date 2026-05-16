export type ChatSourceMode =
  | "explicit_selected"
  | "ui_auto_single"
  | "backend_auto_private"
  | "include_public"
  | "source_discovery"
  | "conversational"
  | "none";

export interface ChatRequestContext {
  requestId?: string;
  sourceMode: ChatSourceMode;
  requestedCollectionIds: string[];
  effectiveCollectionIds: string[];
  includePublic: boolean;
  debugEnabled: boolean;
  retrievalQuery: string;
  uiSelectedCollectionIds?: string[];
  retrievalQueryContextualized?: boolean;
  sourceDiscoveryIntent: boolean;
  conversationalIntent: boolean;
}

export interface BuildChatRequestContextInput {
  requestId?: string;
  body?: unknown;
  requestedCollectionIds?: unknown;
  effectiveCollectionIds?: unknown;
  includePublic?: unknown;
  debugEnabled?: unknown;
  retrievalQuery?: unknown;
  uiSelectedCollectionIds?: unknown;
  uiAutoSingle?: unknown;
  retrievalQueryContextualized?: unknown;
  sourceDiscoveryIntent?: unknown;
  conversationalIntent?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function hasTruthySignal(value: unknown): boolean {
  if (value === true) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.enabled === true || record.detected === true) return true;
  if (typeof record.kind === "string" && record.kind.trim()) return true;
  if (typeof record.intent === "string" && record.intent.trim()) return true;
  return false;
}

export function inferChatSourceMode(input: {
  requestedCollectionIds: string[];
  includePublic: boolean;
  retrievalQuery: string;
  sourceDiscoveryIntent?: boolean;
  conversationalIntent?: boolean;
  uiAutoSingle?: boolean;
}): ChatSourceMode {
  if (input.sourceDiscoveryIntent) return "source_discovery";
  if (input.conversationalIntent) return "conversational";
  if (!input.retrievalQuery.trim()) return "none";
  if (input.requestedCollectionIds.length > 0) {
    return input.uiAutoSingle ? "ui_auto_single" : "explicit_selected";
  }
  if (input.includePublic) return "include_public";
  return "backend_auto_private";
}

export function buildChatRequestContext(input: BuildChatRequestContextInput = {}): ChatRequestContext {
  const body = asRecord(input.body);
  const requestedCollectionIds = normalizeStringArray(
    input.requestedCollectionIds ?? body.collectionIds ?? body.requestedCollectionIds,
  );
  const effectiveCollectionIds = normalizeStringArray(
    input.effectiveCollectionIds ?? body.effectiveCollectionIds ?? requestedCollectionIds,
  );
  const includePublic = normalizeBoolean(input.includePublic ?? body.includePublic);
  const debugEnabled = normalizeBoolean(input.debugEnabled ?? body.debugEnabled);
  const retrievalQuery = normalizeString(input.retrievalQuery ?? body.retrievalQuery ?? body.query);
  const uiSelectedCollectionIds = normalizeStringArray(input.uiSelectedCollectionIds ?? body.uiSelectedCollectionIds);
  const sourceDiscoveryIntent = hasTruthySignal(input.sourceDiscoveryIntent ?? body.sourceDiscoveryIntent);
  const conversationalIntent = hasTruthySignal(input.conversationalIntent ?? body.conversationalIntent);
  const uiAutoSingle = normalizeBoolean(input.uiAutoSingle ?? body.uiAutoSingle);

  return {
    requestId: typeof input.requestId === "string" && input.requestId.trim() ? input.requestId.trim() : undefined,
    sourceMode: inferChatSourceMode({
      requestedCollectionIds,
      includePublic,
      retrievalQuery,
      sourceDiscoveryIntent,
      conversationalIntent,
      uiAutoSingle,
    }),
    requestedCollectionIds,
    effectiveCollectionIds,
    includePublic,
    debugEnabled,
    retrievalQuery,
    uiSelectedCollectionIds: uiSelectedCollectionIds.length > 0 ? uiSelectedCollectionIds : undefined,
    retrievalQueryContextualized: normalizeBoolean(input.retrievalQueryContextualized ?? body.retrievalQueryContextualized),
    sourceDiscoveryIntent,
    conversationalIntent,
  };
}

export function summarizeChatRequestContext(context: ChatRequestContext): Record<string, unknown> {
  return {
    requestId: context.requestId,
    sourceMode: context.sourceMode,
    includePublic: context.includePublic,
    debugEnabled: context.debugEnabled,
    requestedCollectionCount: context.requestedCollectionIds.length,
    effectiveCollectionCount: context.effectiveCollectionIds.length,
    hasRetrievalQuery: context.retrievalQuery.trim().length > 0,
    retrievalQueryContextualized: context.retrievalQueryContextualized === true,
    sourceDiscoveryIntent: context.sourceDiscoveryIntent,
    conversationalIntent: context.conversationalIntent,
  };
}
