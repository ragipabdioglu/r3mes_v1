import { describe, expect, it } from "vitest";

import { buildSafetyEvidenceSignals } from "./safetyEvidenceSignals.js";

const source = {
  collectionId: "kap",
  documentId: "doc_1",
  title: "KAP disclosure",
  chunkIndex: 0,
};

describe("safety evidence signals", () => {
  it("counts usable evidence bundle items independently from legacy facts", () => {
    const signals = buildSafetyEvidenceSignals({
      retrievalWasUsed: true,
      sources: [source],
      answerSpec: {
        answerDomain: "finance",
        answerIntent: "explain",
        groundingConfidence: "medium",
        userQuery: "Net dönem karı kaç?",
        tone: "direct",
        sections: ["assessment"],
        assessment: "12.4 milyon TL",
        action: "",
        caution: [],
        summary: "12.4 milyon TL",
        unknowns: [],
        sourceIds: ["doc_1"],
        facts: [],
      },
      evidenceBundle: {
        userQuery: "Net dönem karı kaç?",
        sourceIds: ["doc_1"],
        requestedFieldIds: ["net_donem_kari"],
        diagnostics: {
          stringFactCount: 0,
          structuredFactCount: 1,
          tableFactCount: 0,
          contradictionCount: 0,
          sourceLimitCount: 0,
        },
        items: [{
          id: "ev_1",
          kind: "numeric_fact",
          sourceId: "doc_1",
          quote: "Net Dönem Kârı: 12.4 milyon TL",
          confidence: "high",
          provenance: { extractor: "test" },
        }],
      },
    });

    expect(signals.legacyUsableFactCount).toBe(0);
    expect(signals.usableEvidenceBundleItemCount).toBe(1);
    expect(signals.requestedFieldCount).toBe(1);
    expect(signals.sourceCount).toBe(1);
    expect(signals.retrievalWasUsed).toBe(true);
  });

  it("derives complete requested-field coverage from an answer plan", () => {
    const signals = buildSafetyEvidenceSignals({
      retrievalWasUsed: true,
      sources: [source],
      answerPlan: {
        domain: "finance",
        intent: "explain",
        taskType: "field_extraction",
        outputFormat: "short",
        requestedFields: [{
          id: "net_donem_kari",
          label: "Net Dönem Kârı",
          aliases: ["net dönem karı"],
          required: true,
          outputHint: "number",
          confidence: "high",
          matchedAliases: ["net dönem karı"],
        }],
        selectedFacts: [{
          id: "fact_1",
          kind: "numeric_value",
          sourceId: "doc_1",
          field: "Net Dönem Kârı",
          value: "12.4 milyon TL",
          confidence: "high",
          provenance: { quote: "Net Dönem Kârı: 12.4 milyon TL", extractor: "test" },
        }],
        constraints: {
          forbidCaution: true,
          noRawTableDump: true,
          sourceGroundedOnly: true,
          format: "short",
        },
        coverage: "complete",
        forbiddenAdditions: [],
        requiresModelSynthesis: false,
        diagnostics: {
          requestedFieldCount: 1,
          selectedFactCount: 1,
          missingFieldIds: [],
        },
      },
    });

    expect(signals.selectedStructuredFactCount).toBe(1);
    expect(signals.requestedFieldCount).toBe(1);
    expect(signals.coveredRequestedFieldCount).toBe(1);
    expect(signals.answerPlanCoverage).toBe("complete");
  });
});
