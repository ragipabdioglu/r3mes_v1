import { describe, expect, it } from "vitest";

import { buildEvalDebugContract, EVAL_DEBUG_CONTRACT_VERSION } from "./evalDebugContract.js";

describe("buildEvalDebugContract", () => {
  it("builds a stable additive debug contract", () => {
    const contract = buildEvalDebugContract({
      answerQualityFindings: [
        {
          bucket: "raw_table_dump",
          severity: "fail",
          message: "answer looks like a raw table row dump",
        },
      ],
      evidenceSignals: {
        legacyUsableFactCount: 1,
        usableEvidenceBundleItemCount: 2,
      },
      evidenceBundleDiagnostics: {
        stringFactCount: 1,
        structuredFactCount: 1,
        tableFactCount: 0,
        contradictionCount: 0,
        sourceLimitCount: 0,
        kindCounts: {
          text_fact: 1,
          definition: 0,
          list_item: 0,
          comparison_point: 0,
          code_fact: 0,
          table_fact: 0,
          numeric_fact: 1,
          procedure_step: 0,
          source_limit: 0,
          contradiction: 0,
        },
      },
      evidenceBundle: {
        userQuery: "Sadece sayıyı yaz.",
        items: [
          {
            id: "fact_1",
            kind: "numeric_fact",
            sourceId: "source_1",
            quote: "Net değer: 42",
            confidence: "high",
            provenance: { extractor: "test" },
          },
        ],
        sourceIds: ["source_1"],
        requestedFieldIds: ["net_deger"],
        diagnostics: {
          stringFactCount: 0,
          structuredFactCount: 1,
          tableFactCount: 0,
          contradictionCount: 0,
          sourceLimitCount: 0,
          kindCounts: {
            text_fact: 0,
            definition: 0,
            list_item: 0,
            comparison_point: 0,
            code_fact: 0,
            table_fact: 0,
            numeric_fact: 1,
            procedure_step: 0,
            source_limit: 0,
            contradiction: 0,
          },
        },
      },
      compiledEvidence: {
        facts: ["Net değer: 42"],
        risks: [],
        unknowns: [],
        contradictions: [],
        sourceIds: ["source_1"],
        items: [
          {
            id: "fact_1",
            kind: "numeric_fact",
            sourceId: "source_1",
            quote: "Net değer: 42",
            confidence: "high",
            provenance: { extractor: "test" },
          },
        ],
        sourceMap: {
          byEvidenceItemId: {
            fact_1: { sourceId: "source_1" },
          },
          byStructuredFactId: {},
        },
        evidenceConfidence: {
          level: "high",
          score: 0.98,
          reasons: ["grounding_high", "coverage_complete"],
          penalties: [],
        },
        answerReadiness: {
          usableForAnswer: true,
          mode: "answer",
          missingFields: [],
          contradictionFields: [],
          requiredEvidenceTypeMatched: true,
          reasons: ["sufficient_evidence"],
        },
        legacyText: {
          facts: ["Net değer: 42"],
          risks: [],
          unknowns: [],
          contradictions: [],
        },
        confidence: "high",
        coverage: {
          status: "complete",
          requestedFieldIds: ["net_deger"],
          coveredFieldIds: ["net_deger"],
          missingFieldIds: [],
          usableEvidenceItemCount: 1,
          structuredFactCount: 1,
          textFactCount: 1,
          contradictionCount: 0,
        },
        sufficiency: {
          status: "sufficient",
          shouldAnswer: true,
          reason: "sufficient_evidence",
          coverage: "complete",
          confidence: "high",
        },
        usableFactCount: 1,
        structuredFactCount: 1,
        riskFactCount: 0,
        unknownCount: 0,
        contradictionCount: 0,
        factLevelDiagnostics: {
          usableEvidenceItemCount: 1,
          selectedTextFactCount: 1,
          selectedStructuredFactCount: 1,
          selectedRiskFactCount: 0,
          selectedUnknownCount: 0,
          selectedContradictionCount: 0,
          selectedSourceCount: 1,
          bundleKindCounts: {
            text_fact: 0,
            definition: 0,
            list_item: 0,
            comparison_point: 0,
            code_fact: 0,
            table_fact: 0,
            numeric_fact: 1,
            procedure_step: 0,
            source_limit: 0,
            contradiction: 0,
          },
          structuredFactKinds: {
            table_cell: 0,
            table_row: 0,
            numeric_value: 1,
            text_claim: 0,
          },
          structuredFactConfidenceCounts: {
            low: 0,
            medium: 0,
            high: 1,
          },
          sourceDistribution: [{ sourceId: "source_1", count: 1 }],
          contradictionSources: [],
          diagnosticsMode: "observed_only",
        },
        diagnostics: {
          decisionConfigVersion: "test",
          confidenceReason: "grounding_high",
          limits: {
            facts: 3,
            structuredFacts: 3,
            risks: 2,
            unknowns: 2,
            sources: 2,
          },
          rawCounts: {
            facts: 1,
            structuredFacts: 1,
            risks: 0,
            unknowns: 0,
            sources: 1,
            contradictions: 0,
          },
        },
      },
      answerPlan: {
        domain: "finance",
        taskType: "extract",
        outputFormat: "short",
        requestedFields: [{ id: "net_deger", label: "Net değer", aliases: [], required: true }],
        selectedFacts: [],
        constraints: {
          forbidCaution: true,
          noRawTableDump: true,
          sourceGroundedOnly: true,
        },
        coverage: "partial",
        requiresModelSynthesis: false,
        diagnostics: {
          requestedFieldCount: 1,
          selectedFactCount: 0,
          missingFieldIds: ["net_deger"],
        },
      },
      composerDiagnostics: {
        path: "planned_structured",
        plannedComposerUsed: true,
        fallbackTemplateUsed: false,
        lowLanguageQualityDetected: false,
      },
      sourceCount: 1,
      sourceSelection: { selectionMode: "selected" },
      runtimeLineage: {
        version: 1,
        profileName: "eval",
        answerPath: "rag_fast_path",
        stream: false,
        qwen: {
          called: false,
          validatorCalled: false,
          callCount: 0,
        },
        composer: {
          deterministicUsed: true,
        },
        retrieval: {
          mode: "true_hybrid",
          qdrantUsed: true,
        },
        embedding: {
          fallbackUsed: false,
        },
        reranker: {
          fallbackUsed: false,
        },
        safety: {
          blockedReasonCount: 0,
        },
        controlTower: {
          qualityFallbackUsed: false,
        },
      },
    });

    expect(contract.version).toBe(EVAL_DEBUG_CONTRACT_VERSION);
    expect(contract.answerQuality?.passed).toBe(false);
    expect(contract.answerQuality?.findings).toHaveLength(1);
    expect(contract.evidenceSignals).toEqual({
      legacyUsableFactCount: 1,
      usableEvidenceBundleItemCount: 2,
    });
    expect(contract.evidenceBundleDiagnostics?.structuredFactCount).toBe(1);
    expect(contract.answerBaseline).toMatchObject({
      evidenceBundle: {
        itemCount: 1,
        usableItemCount: 1,
        requestedFieldIds: ["net_deger"],
      },
      compiledEvidence: {
        confidence: "high",
        confidenceReason: "grounding_high",
        usableFactCount: 1,
        coverage: {
          status: "complete",
          requestedFieldIds: ["net_deger"],
          coveredFieldIds: ["net_deger"],
          missingFieldIds: [],
        },
        sufficiency: {
          status: "sufficient",
          shouldAnswer: true,
          reason: "sufficient_evidence",
        },
        answerReadiness: {
          mode: "answer",
          usableForAnswer: true,
          requiredEvidenceTypeMatched: true,
        },
        evidenceConfidence: {
          level: "high",
          penalties: [],
        },
        sourceMapCompleteness: 1,
        typedEvidenceRatio: 0.5,
        legacyFallbackUsed: false,
        factLevelDiagnostics: {
          selectedStructuredFactCount: 1,
          bundleKindCounts: {
            numeric_fact: 1,
          },
          diagnosticsMode: "observed_only",
        },
      },
      answerPlan: {
        taskType: "extract",
        outputFormat: "short",
        coverage: "partial",
        missingFieldIds: ["net_deger"],
      },
      composer: {
        path: "planned_structured",
        plannedComposerUsed: true,
        fallbackTemplateUsed: false,
        lowLanguageQualityDetected: false,
      },
      evidenceToAnswerPath: {
        sufficiencyStatus: "sufficient",
        shouldAnswer: true,
        answerPlanCoverage: "partial",
        requiresModelSynthesis: false,
        composerPath: "planned_structured",
        plannedComposerUsed: true,
        fallbackTemplateUsed: false,
        safetyPass: null,
        safetySeverity: null,
        diagnosis: "evidence_sufficient_planned_answer",
      },
      sourceCount: 1,
    });
    expect(contract.sourceSelection).toEqual({ selectionMode: "selected" });
    expect(contract.runtimeLineage).toMatchObject({
      answerPath: "rag_fast_path",
      qwen: { called: false },
      embedding: { fallbackUsed: false },
      controlTower: { qualityFallbackUsed: false },
    });
  });

  it("derives observed fact-level diagnostics when compiled evidence does not carry them yet", () => {
    const contract = buildEvalDebugContract({
      evidenceBundle: {
        userQuery: "Toplam nedir?",
        items: [
          {
            id: "fact_1",
            kind: "text_fact",
            sourceId: "source_1",
            quote: "Toplam 42",
            confidence: "high",
            provenance: { extractor: "test" },
          },
        ],
        sourceIds: ["source_1"],
        requestedFieldIds: [],
        diagnostics: {
          stringFactCount: 1,
          structuredFactCount: 0,
          tableFactCount: 0,
          contradictionCount: 0,
          sourceLimitCount: 0,
          kindCounts: {
            text_fact: 1,
            definition: 0,
            list_item: 0,
            comparison_point: 0,
            code_fact: 0,
            table_fact: 0,
            numeric_fact: 0,
            procedure_step: 0,
            source_limit: 0,
            contradiction: 0,
          },
        },
      },
      compiledEvidence: {
        facts: ["Toplam 42"],
        risks: [],
        unknowns: [],
        contradictions: [],
        sourceIds: ["source_1"],
        confidence: "high",
        usableFactCount: 1,
        structuredFactCount: 0,
        riskFactCount: 0,
        unknownCount: 0,
        contradictionCount: 0,
      },
    });

    expect(contract.answerBaseline?.compiledEvidence.factLevelDiagnostics).toMatchObject({
      usableEvidenceItemCount: 1,
      selectedTextFactCount: 1,
      selectedStructuredFactCount: 0,
      selectedSourceCount: 1,
      sourceDistribution: [{ sourceId: "source_1", count: 1 }],
      diagnosticsMode: "observed_only",
    });
  });
});
