import { describe, expect, it, vi } from "vitest";

import {
  buildDeterministicEvidenceExtraction,
  buildDeterministicQueryPlan,
  evidenceOutputUsableTextFacts,
  getEvidenceExtractorBudget,
  resolveAnswerIntent,
  runEvidenceExtractorSkill,
  runQueryPlannerSkill,
} from "./skillPipeline.js";

describe("skill pipeline query planner", () => {
  it("derives expected evidence type from the generic query task contract", () => {
    const plan = buildDeterministicQueryPlan({ userQuery: "Desteklenen özellikleri madde madde yaz.", language: "tr" });

    expect(plan.expectedEvidenceType).toBe("list");
    expect(plan.searchQueries).toContain("Desteklenen özellikleri madde madde yaz.");
    expect(plan.retrievalQuery).toContain("Desteklenen özellikleri madde madde yaz.");
  });

  it("keeps query planner execution behind the v2 skill envelope", async () => {
    const run = await runQueryPlannerSkill({ userQuery: "saveHandler içinde ne yapılıyor?", language: "tr" });

    expect(run.skill).toBe("query-planner");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.expectedEvidenceType).toBe("code");
  });
});

describe("skill pipeline evidence extractor", () => {
  it("resolves answer intent from query task and typed evidence counts", () => {
    const checklist = resolveAnswerIntent({
      userQuery: "Migration öncesi kısa bir kontrol listesi verir misin?",
      weakIntent: "steps",
      directFactCount: 2,
      sourceCount: 1,
    });

    expect(checklist.intent).toBe("steps");
    expect(checklist.primarySignal).toBe("steps");
    expect(checklist.confidence).toBe("high");
    expect(checklist.reasons).toEqual(expect.arrayContaining(["intent derived from query contract and typed evidence"]));

    const noSource = resolveAnswerIntent({
      userQuery: "Bu belgeye göre kesin sonuç nedir?",
      weakIntent: "explain",
      directFactCount: 0,
      missingInfoCount: 1,
      sourceCount: 0,
    });

    expect(noSource.primarySignal).toBe("no_source");
    expect(noSource.intent).toBe("unknown");
    expect(noSource.reasons).toEqual(expect.arrayContaining(["no usable typed evidence was found"]));
  });

  it("reads evidence extractor budgets from config", () => {
    vi.stubEnv("R3MES_EVIDENCE_USABLE_FACT_LIMIT", "3");

    expect(getEvidenceExtractorBudget()).toMatchObject({
      usableFactLimit: 3,
    });

    vi.unstubAllEnvs();
  });

  it("extracts typed list evidence without legacy supporting or risk buckets", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Sistemin temel bileşenleri nelerdir?",
      cards: [
        {
          sourceId: "generic-system-components",
          title: "generic-system-components",
          rawContent: [
            "Sistemin Temel Bileşenleri:",
            "- Algılama: Ortamdan veri toplar.",
            "- Bağlantı: Veriyi merkeze iletir.",
            "- İşleme: Gelen veriyi analiz eder.",
          ].join("\n"),
        },
      ],
    });

    const joined = evidenceOutputUsableTextFacts(extraction).join(" ");
    expect(joined).toContain("Algılama");
    expect(joined).toContain("Bağlantı");
    expect(extraction.evidenceBundle?.diagnostics.kindCounts.list_item).toBeGreaterThanOrEqual(2);
    expect(extraction.missingInfo).toEqual([]);
  });

  it("keeps method body details as typed code evidence", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "saveHandler içinde ne yapılıyor?",
      cards: [
        {
          sourceId: "generic-handler-source",
          title: "generic-handler-source",
          rawContent:
            "function saveHandler() { if (input.value.length > 0) { list.push(input.value); } input.value = ''; input.focus(); }",
        },
      ],
    });

    const joined = evidenceOutputUsableTextFacts(extraction).join(" ");
    expect(joined).toContain("saveHandler");
    expect(joined).toContain("input.value.length");
    expect(joined).toContain("list.push");
    expect(extraction.evidenceBundle?.diagnostics.kindCounts.code_fact).toBeGreaterThanOrEqual(1);
  });

  it("extracts adjacent subject context for generic comparison evidence", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Alpha ile Beta arasındaki fark nedir?",
      cards: [
        {
          sourceId: "generic-comparison-source",
          title: "generic-comparison-source",
          rawContent:
            "Beta nesnesi gelişmiş içeriklerle çalışır. Alpha'ya göre biçimlendirilebilir metin, aktif bağlantı ve medya gibi farkları vardır.",
        },
      ],
    });

    const joined = evidenceOutputUsableTextFacts(extraction).join(" ");
    expect(joined).toContain("Alpha'ya göre");
    expect(extraction.evidenceBundle?.diagnostics.kindCounts.comparison_point).toBeGreaterThanOrEqual(1);
  });

  it("returns no-source when the v2 extractor finds no usable typed evidence", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Bambaşka bir konuda kesin cevap nedir?",
      cards: [
        {
          sourceId: "unrelated-source",
          title: "unrelated-source",
          rawContent: "Bu kaynak sadece farklı bir prosedürün kurulum notlarını içerir.",
        },
      ],
    });

    expect(evidenceOutputUsableTextFacts(extraction)).toEqual([]);
    expect(extraction.intentResolution.primarySignal).toBe("no_source");
    expect(extraction.missingInfo).toEqual(
      expect.arrayContaining(["No usable typed evidence item was found for this query."]),
    );
  });

  it("keeps evidence extraction behind the v2 skill envelope", async () => {
    const run = await runEvidenceExtractorSkill({
      userQuery: "Desteklenen adımları madde madde yaz.",
      cards: [
        {
          sourceId: "doc-steps",
          title: "doc-steps",
          rawContent: ["Desteklenen adımlar:", "- Hazırla", "- Çalıştır", "- Doğrula"].join("\n"),
        },
      ],
    });

    expect(run.skill).toBe("evidence-extractor");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.evidenceBundle?.items.length).toBeGreaterThan(0);
  });
});
