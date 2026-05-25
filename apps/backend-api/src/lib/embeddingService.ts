import { createHash } from "node:crypto";

import type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingResult,
  ProviderLineageDiagnostics,
} from "@r3mes/shared-types";

import {
  embedTextForQdrantWithDiagnostics,
  type QdrantEmbeddingDiagnostics,
} from "./qdrantEmbedding.js";

export interface EmbeddingProviderRegistration {
  id: "bge-m3-dense" | "deterministic-dev";
  provider: Exclude<EmbeddingProvider, "external">;
  transport: "ai-engine-http" | "in-process";
  output: "dense";
  expectedModelIncludes: readonly string[];
  requiredInStrictRuntime: boolean;
  devOnly: boolean;
}

export const EMBEDDING_PROVIDER_REGISTRY = {
  "bge-m3-dense": {
    id: "bge-m3-dense",
    provider: "bge-m3",
    transport: "ai-engine-http",
    output: "dense",
    expectedModelIncludes: ["bge-m3"],
    requiredInStrictRuntime: true,
    devOnly: false,
  },
  "deterministic-dev": {
    id: "deterministic-dev",
    provider: "deterministic-dev",
    transport: "in-process",
    output: "dense",
    expectedModelIncludes: [],
    requiredInStrictRuntime: false,
    devOnly: true,
  },
} as const satisfies Record<string, EmbeddingProviderRegistration>;

type ExistingEmbeddingCall = typeof embedTextForQdrantWithDiagnostics;

export interface EmbeddingServiceDependencies {
  embedText: ExistingEmbeddingCall;
  now: () => Date;
  elapsedMs: (startedAt: number) => number;
  startClock: () => number;
}

export interface EmbeddingServiceV2 {
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}

function createInputHash(input: EmbeddingInput): string {
  return createHash("sha256")
    .update(
      [
        input.targetType,
        input.targetId ?? "",
        input.purpose,
        input.languageHint ?? "",
        String(input.textVersion ?? ""),
        input.text,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

function isBgeM3Model(model: string | undefined): boolean {
  return model?.toLowerCase().includes("bge-m3") ?? false;
}

export function mapEmbeddingProvider(diagnostics: QdrantEmbeddingDiagnostics): EmbeddingProvider {
  if (diagnostics.actualProvider === "deterministic" || diagnostics.fallbackUsed) {
    return "deterministic-dev";
  }
  if (diagnostics.actualProvider === "bge-m3" || isBgeM3Model(diagnostics.model)) {
    return "bge-m3";
  }
  return "external";
}

export function resolveEmbeddingProviderRegistration(
  diagnostics: QdrantEmbeddingDiagnostics,
): EmbeddingProviderRegistration | undefined {
  const provider = mapEmbeddingProvider(diagnostics);
  if (provider === "bge-m3") {
    return EMBEDDING_PROVIDER_REGISTRY["bge-m3-dense"];
  }
  if (provider === "deterministic-dev") {
    return EMBEDDING_PROVIDER_REGISTRY["deterministic-dev"];
  }
  return undefined;
}

export function toProviderLineageDiagnostics(
  diagnostics: QdrantEmbeddingDiagnostics,
): ProviderLineageDiagnostics {
  const registration = resolveEmbeddingProviderRegistration(diagnostics);
  return {
    requestedProvider: diagnostics.requestedProvider,
    actualProvider: mapEmbeddingProvider(diagnostics),
    model: diagnostics.model,
    transport: diagnostics.transport ?? registration?.transport ?? "ai-engine-http",
    pooling: diagnostics.pooling ?? "unknown",
    device: diagnostics.device ?? "unknown",
    fallbackUsed: diagnostics.fallbackUsed,
    fallbackReason: diagnostics.error,
    warnings:
      mapEmbeddingProvider(diagnostics) === "external"
        ? ["embedding model identity was not sufficient to prove BGE-M3 lineage"]
        : undefined,
  };
}

export function createEmbeddingServiceV2(
  dependencies: Partial<EmbeddingServiceDependencies> = {},
): EmbeddingServiceV2 {
  const deps: EmbeddingServiceDependencies = {
    embedText: dependencies.embedText ?? embedTextForQdrantWithDiagnostics,
    now: dependencies.now ?? (() => new Date()),
    startClock: dependencies.startClock ?? (() => Date.now()),
    elapsedMs: dependencies.elapsedMs ?? ((startedAt) => Math.max(0, Date.now() - startedAt)),
  };

  return {
    async embed(input): Promise<EmbeddingResult> {
      const startedAt = deps.startClock();
      const result = await deps.embedText(input.text);
      const registration = resolveEmbeddingProviderRegistration(result.diagnostics);

      return {
        targetType: input.targetType,
        targetId: input.targetId,
        purpose: input.purpose,
        vector: result.vector,
        normalized: result.diagnostics.normalized ?? true,
        fallbackUsed: result.diagnostics.fallbackUsed,
        fallbackReason: result.diagnostics.error,
        provider: mapEmbeddingProvider(result.diagnostics),
        model: result.diagnostics.model ?? "unknown",
        dimension: result.diagnostics.dimension,
        transport: result.diagnostics.transport ?? registration?.transport ?? "ai-engine-http",
        pooling: result.diagnostics.pooling ?? "unknown",
        device: result.diagnostics.device ?? "unknown",
        inputHash: createInputHash(input),
        latencyMs: deps.elapsedMs(startedAt),
        createdAt: deps.now().toISOString(),
      };
    },
  };
}

export const embeddingServiceV2 = createEmbeddingServiceV2();
