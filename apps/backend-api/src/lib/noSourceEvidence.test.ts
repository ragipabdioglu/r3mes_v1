import { describe, expect, it } from "vitest";

import { buildEvidenceBundle } from "./evidenceBundle.js";
import { ensureNoSourceEvidence } from "./noSourceEvidence.js";
import { evidenceOutputLimitText } from "./skillPipeline.js";
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
    sourceIds: [],
    missingInfo: [],
    structuredFacts: [],
    evidenceBundle: buildEvidenceBundle({ userQuery: "Soru" }),
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

    expect(evidenceOutputLimitText(output).join(" ")).toContain("Kaynaklarda");
    expect(output.missingInfo.join(" ")).toContain("Kaynak deste");
    expect(output.sourceIds).toEqual(["doc-a"]);
    expect(output.evidenceBundle?.items).toHaveLength(0);
    expect(output.evidenceBundle?.coverage).toMatchObject({
      status: "none",
      reason: "no_source",
    });
  });

  it("does not alter evidence that already has usable facts", () => {
    const original = evidence({
      sourceIds: ["doc-a"],
      evidenceBundle: buildEvidenceBundle({
        userQuery: "Soru",
        textFacts: ["Kaynakta acik bilgi var."],
        sourceIds: ["doc-a"],
      }),
    });

    expect(ensureNoSourceEvidence({ userQuery: "Soru", evidence: original })).toBe(original);
  });
});
