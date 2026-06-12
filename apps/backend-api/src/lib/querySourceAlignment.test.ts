import { describe, expect, it } from "vitest";

import { scoreQuerySourceAlignment } from "./querySourceAlignment.js";

describe("querySourceAlignment", () => {
  it("uses profile table concepts as source alignment evidence", () => {
    const alignment = scoreQuerySourceAlignment({
      query: "net kar tablosundaki değişimi açıkla",
      sourceText: [
        "KAP finansal tablo",
        "table evidence structured table net kar hasılat",
        "Şirket dönemsel finansal bilgilerini tablo içinde açıklamıştır.",
      ].join("\n"),
      minScore: 0.18,
      weakScore: 0.32,
      genericPenalty: 0.2,
    });

    expect(alignment.mode).not.toBe("mismatch");
    expect(alignment.matchedTerms).toEqual(expect.arrayContaining(["net", "kar"]));
  });

  it("keeps same-domain wrong-topic sources as mismatch when only generic terms match", () => {
    const alignment = scoreQuerySourceAlignment({
      query: "başım ağrıyor ne yapmalıyım",
      sourceText: "Clinical Card Topic: karın ağrısı genel triyaj Tags: karın, mide, ağrı",
      minScore: 0.18,
      weakScore: 0.32,
      genericPenalty: 0.2,
    });

    expect(alignment.mode).toBe("mismatch");
    expect(alignment.matchedTerms).not.toContain("bas");
  });

  it("keeps generic UI-like layout evidence for visual layout questions", () => {
    const alignment = scoreQuerySourceAlignment({
      query: "Form tasarımında görünen temel kontroller nelerdir?",
      sourceText: "Session 8 layout notes: AlphaBox, BetaButton, GammaLabel, DeltaPicker, OmegaBar.",
      minScore: 0.34,
      weakScore: 0.5,
      genericPenalty: 0.2,
    });

    expect(alignment.mode).not.toBe("mismatch");
    expect(alignment.matchedTerms).toContain("visual layout");
  });
});
