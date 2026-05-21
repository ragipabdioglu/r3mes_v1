import { describe, expect, it } from "vitest";

import { buildEvidenceBundle, countUsableEvidenceItems } from "./evidenceBundle.js";

describe("buildEvidenceBundle", () => {
  it("keeps legacy text fact assignment when no operation signal is provided", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Kaynaklar ne diyor?",
      textFacts: ["doc-1: Kaynaklar arasında çelişen bilgiler var."],
      sourceIds: ["doc-1"],
    });

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]?.kind).toBe("contradiction");
    expect(bundle.diagnostics.kindCounts.contradiction).toBe(1);
    expect(bundle.diagnostics.kindCounts.text_fact).toBe(0);
    expect(countUsableEvidenceItems(bundle)).toBe(0);
  });

  it("assigns data-independent text fact kinds from task type", () => {
    const definition = buildEvidenceBundle({
      userQuery: "Bu kavram nedir?",
      taskType: "definition",
      textFacts: ["doc-1: Kavram, kaynakta bir çalışma biçimi olarak tanımlanır."],
      sourceIds: ["doc-1"],
    });
    const list = buildEvidenceBundle({
      userQuery: "Maddeleri nelerdir?",
      taskType: "list_items",
      textFacts: ["doc-1: İlk madde kaynakta yer alır."],
      sourceIds: ["doc-1"],
    });
    const comparison = buildEvidenceBundle({
      userQuery: "A ve B arasındaki fark nedir?",
      taskType: "compare_concepts",
      textFacts: ["doc-1: A ve B kaynakta farklı kapsamlarla açıklanır."],
      sourceIds: ["doc-1"],
    });
    const procedure = buildEvidenceBundle({
      userQuery: "Nasıl yapılır?",
      taskType: "procedure",
      textFacts: ["doc-1: Kaynakta işlem sırayla uygulanır."],
      sourceIds: ["doc-1"],
    });

    expect(definition.items[0]?.kind).toBe("definition");
    expect(list.items[0]?.kind).toBe("list_item");
    expect(comparison.items[0]?.kind).toBe("comparison_point");
    expect(procedure.items[0]?.kind).toBe("procedure_step");
    expect(definition.diagnostics.kindCounts.definition).toBe(1);
    expect(list.diagnostics.kindCounts.list_item).toBe(1);
    expect(comparison.diagnostics.kindCounts.comparison_point).toBe(1);
    expect(procedure.diagnostics.kindCounts.procedure_step).toBe(1);
    expect(countUsableEvidenceItems(definition)).toBe(1);
    expect(countUsableEvidenceItems(list)).toBe(1);
    expect(countUsableEvidenceItems(comparison)).toBe(1);
    expect(countUsableEvidenceItems(procedure)).toBe(1);
  });

  it("allows explicit evidence type to override task type for text facts only", () => {
    const bundle = buildEvidenceBundle({
      userQuery: "Kod gerçeği nedir?",
      taskType: "definition",
      evidenceType: "code_fact",
      textFacts: ["doc-1: Fonksiyon kaynakta değer döndürür."],
      riskFacts: ["doc-1: Kaynakta çalışma zamanı garantisi yok."],
      notSupported: ["doc-1: Kaynakta ikinci fonksiyon belirtilmiyor."],
      sourceIds: ["doc-1"],
    });

    expect(bundle.items.map((item) => item.kind)).toEqual(["code_fact", "text_fact", "source_limit"]);
    expect(bundle.diagnostics.kindCounts).toMatchObject({
      code_fact: 1,
      text_fact: 1,
      source_limit: 1,
      table_fact: 0,
      numeric_fact: 0,
    });
    expect(countUsableEvidenceItems(bundle)).toBe(2);
  });
});
