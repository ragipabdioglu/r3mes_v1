import { describe, expect, it } from "vitest";

import { hasLowLanguageQuality, polishAnswerText } from "./answerQuality.js";

describe("answer quality polish", () => {
  it("repairs generic malformed Turkish without adding domain facts", () => {
    const polished = polishAnswerText(
      "Yanıt: Smear sonucu temiz oldu, ancak kasik agrisi var. Daha fazla izin vermeniz gerekebilir.",
    );

    expect(polished).toContain("kasık ağrısı");
    expect(polished).toContain("yeniden değerlendirme gerekebilir");
    expect(polished).not.toContain("izin vermeniz");
    expect(polished).not.toContain("CA-125");
  });

  it("flags repeated or malformed language as low quality", () => {
    expect(hasLowLanguageQuality("Her şeyi her şeyi her şeyi karşılaştırın.")).toBe(true);
    expect(hasLowLanguageQuality("Daha fazla izin vermeniz gerekebilir.")).toBe(true);
    expect(hasLowLanguageQuality("Bebeğin fiziksel运动（这可能是翻译错误） nedeniyle terliyor olabilir.")).toBe(true);
    expect(hasLowLanguageQuality("Kasık ağrısı sürerse doktor kontrolü planlanabilir.")).toBe(false);
  });
});
