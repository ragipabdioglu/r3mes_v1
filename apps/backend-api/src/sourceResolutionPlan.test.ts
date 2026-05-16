import { describe, expect, it } from "vitest";
import {
  buildSourceResolutionPlan,
  summarizeSourceResolutionPlan,
} from "./lib/sourceResolutionPlan.js";
import type { KnowledgeCollectionAccessItem } from "./lib/knowledgeAccess.js";
import type { QueryUnderstanding } from "./lib/queryUnderstanding.js";

function collection(
  id: string,
  name: string,
  visibility: KnowledgeCollectionAccessItem["visibility"] = "PRIVATE",
): KnowledgeCollectionAccessItem {
  return {
    id,
    name,
    visibility,
    autoMetadata: {
      profile: {
        domains: [name],
        keywords: [name],
      },
    },
    documents: [],
  };
}

function understanding(confidence: QueryUnderstanding["confidence"]): QueryUnderstanding {
  return {
    original: "Net dönem karı kaçtır?",
    normalized: {
      original: "Net dönem karı kaçtır?",
      normalized: "net donem kari kactir",
      tokens: ["net", "donem", "kari"],
      expandedTokens: ["net", "donem", "kari"],
      expansions: [],
    },
    signals: {
      language: "tr",
      intent: "question",
      entities: [],
      keywords: [],
      routeHints: {
        domain: "finance",
        confidence,
        subtopics: [],
        mustIncludeTerms: [],
        retrievalHints: [],
      },
    },
    concepts: ["finance"],
    profileConcepts: [],
    quality: {
      shape: "normal",
      clarityScore: confidence === "low" ? 35 : 72,
      tokenCount: 3,
      expandedTokenCount: 3,
      profileConceptCount: 0,
      conceptCount: 1,
      weakSignalCount: 2,
    },
    mode: "knowledge",
    retrievalIntent: "knowledge_lookup",
    conversationalIntent: null,
    answerTask: {
      taskType: "lookup",
      answerIntent: "direct_answer",
      confidence,
      targetDocumentHints: [],
      outputConstraints: [],
      forbiddenAdditions: [],
      diagnostics: { taskReasons: [] },
      requestedFieldDetection: {
        requestedFields: [],
        confidence: "low",
        reasons: [],
      },
    },
    requestedFieldDetection: {
      requestedFields: [],
      confidence: "low",
      reasons: [],
    },
    confidence,
    warnings: [],
  } as QueryUnderstanding;
}

describe("buildSourceResolutionPlan", () => {
  it("preserves explicit accessible collection selection", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [collection("kap", "KAP Finans")],
      requestedCollectionIds: ["kap", "missing"],
      retrievalQuery: "Net dönem karı kaçtır?",
      queryUnderstanding: understanding("high"),
    });

    expect(plan.mode).toBe("explicit");
    expect(plan.selectedCollectionIds).toEqual(["kap"]);
    expect(plan.confidence).toBe(1);
    expect(plan.rejected).toEqual([{
      collectionId: "missing",
      reason: "requested_collection_not_accessible",
    }]);
  });

  it("selects a single private collection automatically", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [collection("only", "Tek kaynak")],
      retrievalQuery: "Net dönem karı kaçtır?",
      queryUnderstanding: understanding("medium"),
    });

    expect(plan.mode).toBe("auto_single_private");
    expect(plan.selectedCollectionIds).toEqual(["only"]);
    expect(plan.confidence).toBe(1);
  });

  it("marks explicit source discovery intent before retrieval source selection", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [
        collection("finance", "KAP Finans"),
        collection("hr", "Insan Kaynaklari"),
      ],
      retrievalQuery: "hangi kaynak bunu cevaplar?",
      queryUnderstanding: understanding("medium"),
      sourceDiscoveryIntent: true,
    });

    expect(plan.mode).toBe("source_discovery");
    expect(plan.selectedCollectionIds).toEqual([]);
    expect(plan.suggestions?.map((item) => item.collectionId).sort()).toEqual(["finance", "hr"]);
  });

  it("requires user scope for multiple private collections when low confidence guard is enforced", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [
        collection("finance", "KAP Finans"),
        collection("hr", "Insan Kaynaklari"),
      ],
      retrievalQuery: "kaçtır",
      queryUnderstanding: understanding("low"),
      rankedCandidates: [
        { collectionId: "finance", score: 0.31, reasons: ["weak_match"] },
        { collectionId: "hr", score: 0.29, reasons: ["weak_match"] },
      ],
      enforceLowConfidenceGuard: true,
    });

    expect(plan.mode).toBe("needs_user_scope");
    expect(plan.selectedCollectionIds).toEqual([]);
    expect(plan.warnings).toContain("user_scope_required");
    expect(plan.rejected.map((item) => item.collectionId)).toEqual(["finance", "hr"]);
  });

  it("keeps legacy broad private selection when low confidence guard is not enforced", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [
        collection("finance", "KAP Finans"),
        collection("hr", "Insan Kaynaklari"),
      ],
      retrievalQuery: "kaçtır",
      queryUnderstanding: understanding("low"),
      rankedCandidates: [
        { collectionId: "finance", score: 0.31 },
        { collectionId: "hr", score: 0.29 },
      ],
    });

    expect(plan.mode).toBe("auto_private_ranked");
    expect(plan.selectedCollectionIds).toEqual(["finance", "hr"]);
    expect(plan.warnings).toContain("low_confidence_guard_not_enforced_legacy_selection");
  });

  it("summarizes source resolution plan without losing the top candidate trace", () => {
    const plan = buildSourceResolutionPlan({
      accessibleCollections: [
        collection("finance", "KAP Finans"),
        collection("legal", "Hukuk"),
      ],
      retrievalQuery: "Net dönem karı kaçtır?",
      queryUnderstanding: understanding("high"),
      rankedCandidates: [
        { collectionId: "finance", score: 0.92, reasons: ["finance_profile"] },
        { collectionId: "legal", score: 0.2, reasons: ["low_match"] },
      ],
    });

    const summary = summarizeSourceResolutionPlan(plan);
    expect(summary.mode).toBe("auto_private_ranked");
    expect(summary.selectedCollectionIds).toEqual(["finance"]);
    expect(summary.candidateCount).toBe(2);
    expect(summary.topCandidates[0]).toMatchObject({
      collectionId: "finance",
      score: 0.92,
    });
  });
});
