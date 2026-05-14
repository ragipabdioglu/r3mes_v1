import { describe, expect, it } from "vitest";

import { extractTableNumericFacts } from "./tableNumericFactExtractor.js";

describe("extractTableNumericFacts", () => {
  it("extracts requested KAP numeric fields as structured facts", () => {
    const facts = [
      "kap-doc: Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 3.850.000.000 - Olağanüstü Yedekler 3.352.908.083 3.850.000.000",
      "kap-doc: Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş.",
    ];

    const structuredFacts = extractTableNumericFacts({
      query:
        "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
      facts,
      sourceIds: ["kap-doc"],
    });

    expect(structuredFacts.map((fact) => fact.field)).toEqual(
      expect.arrayContaining(["Dağıtılması Öngörülen Diğer Kaynaklar", "Olağanüstü Yedekler"]),
    );
    expect(structuredFacts.find((fact) => fact.field === "Dağıtılması Öngörülen Diğer Kaynaklar")?.value).toContain(
      "3.352.908.083",
    );
    expect(structuredFacts.every((fact) => fact.provenance.extractor === "table-numeric-v1")).toBe(true);
  });

  it("does not emit facts when the query does not request a known table field", () => {
    const structuredFacts = extractTableNumericFacts({
      query: "Bu KAP açıklamasını kısa özetle",
      facts: ["kap-doc: Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083"],
      sourceIds: ["kap-doc"],
    });

    expect(structuredFacts).toEqual([]);
  });

  it("preserves SPK column context when the source row provides it", () => {
    const structuredFacts = extractTableNumericFacts({
      query: "SPK'ya göre net dönem kârı kaç?",
      facts: ["kap-doc: SPK'ya Göre / Yasal Kayıtlara Göre: 5. Net Dönem Kârı ( = ) 511.801.109 (3.777.110.075)"],
      sourceIds: ["kap-doc"],
    });

    expect(structuredFacts[0]?.field).toBe("Net Dönem Kârı");
    expect(structuredFacts[0]?.table?.columnLabel).toBe("SPK'ya Göre");
  });

  it("separates generic period profit from net period profit and ignores document ids before the row", () => {
    const structuredFacts = extractTableNumericFacts({
      query: "KCHOL 1574205 tablosunda SPK'ya göre dönem kârı ve net dönem kârı kaç?",
      facts: [
        "KCHOL 1574205 Kar Payı Dağıtım Tablosu.pdf: SPK’ya Göre Yasal Kayıtlara Göre 3. Dönem Kârı 87.713.503.000,00 44.999.997.398,02 5. Net Dönem Kârı ( = ) 22.000.501.000,00 43.212.326.966,00",
        "KCHOL 1574205 Kar Payı Dağıtım Tablosu.pdf: NET DAĞITILABİLİR DÖNEM KÂRI (=) 22.000.501.000,00 43.212.326.966,00 Yıl İçinde Dağıtılan Kar Payı Avansı (-) 0,00 0,00",
      ],
      sourceIds: ["kap-doc"],
    });

    const periodProfit = structuredFacts.find((fact) => fact.field === "Dönem Kârı");
    const netProfit = structuredFacts.find((fact) => fact.field === "Net Dönem Kârı");

    expect(periodProfit?.value).toContain("87.713.503.000,00");
    expect(periodProfit?.value).not.toContain("1574205");
    expect(netProfit?.value).toContain("22.000.501.000,00");
  });
});
