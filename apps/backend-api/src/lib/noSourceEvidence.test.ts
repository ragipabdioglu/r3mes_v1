import { describe, expect, it } from "vitest";

import { ensureNoSourceEvidence } from "./noSourceEvidence.js";
import type { EvidenceExtractorOutput } from "./skillPipeline.js";

function evidence(overrides: Partial<EvidenceExtractorOutput> = {}): EvidenceExtractorOutput {
  return {
    answerIntent: "grounded_answer",
    intentResolution: {
      intent: "grounded_answer",
      primarySignal: "no_source",
      confidence: "low",
      scores: {},
      weakIntent: "grounded_answer",
      reasons: [],
    },
    directAnswerFacts: [],
    supportingContext: [],
    riskFacts: [],
    notSupported: [],
    usableFacts: [],
    uncertainOrUnusable: [],
    redFlags: [],
    sourceIds: [],
    missingInfo: [],
    ...overrides,
  };
}

describe("ensureNoSourceEvidence", () => {
  it("adds source-limit evidence when retrieval attempted but no usable support exists", () => {
    const output = ensureNoSourceEvidence({
      userQuery: "Bu kaynaklarda anlatiliyor mu?",
      evidence: evidence(),
      attemptedSourceIds: ["doc-a"],
    });

    expect(output.notSupported.join(" ")).toContain("Kaynaklarda");
    expect(output.missingInfo.join(" ")).toContain("Kaynak deste");
    expect(output.sourceIds).toEqual(["doc-a"]);
    expect(output.evidenceBundle?.items).toHaveLength(1);
    expect(output.evidenceBundle?.items[0]).toMatchObject({
      kind: "source_limit",
      sourceId: "doc-a",
      provenance: { extractor: "no-source-evidence-v1" },
    });
  });

  it("does not alter evidence that already has usable facts", () => {
    const original = evidence({ usableFacts: ["doc-a: Kaynakta acik bilgi var."] });

    expect(ensureNoSourceEvidence({ userQuery: "Soru", evidence: original })).toBe(original);
  });
});
