import { describe, expect, it } from "vitest";

import { getDomainSafetyPolicy, getRiskyCertaintyPatterns } from "./domainSafetyPolicy.js";

function matchesDomainRisk(domain: Parameters<typeof getRiskyCertaintyPatterns>[0], text: string): boolean {
  return getRiskyCertaintyPatterns(domain).some((pattern) => pattern.test(text));
}

describe("domain safety policy registry", () => {
  it("keeps medical diagnosis and treatment certainty in the medical policy", () => {
    expect(matchesDomainRisk("medical", "Bu kesin kanserdir, hemen tedaviye başla.")).toBe(true);
    expect(getDomainSafetyPolicy("medical").redFlagTerms).toContain("şiddetli");
  });

  it("detects legal outcome guarantees without relying on medical rules", () => {
    expect(matchesDomainRisk("legal", "Davayı kesin kazanırsınız, avukata gerek yok.")).toBe(true);
    expect(getDomainSafetyPolicy("legal").fallbackGuidance.action).toContain("Kesin hukuki görüş");
  });

  it("does not flag cautious negated certainty or Turkish suffixes", () => {
    expect(matchesDomainRisk("legal", "Kesin hukuki görüş vermek doğru olmaz.")).toBe(false);
    expect(matchesDomainRisk("legal", "Kaynakta açık dayanak yoksa kesin sonuç söylenmemelidir.")).toBe(false);
    expect(matchesDomainRisk("legal", "Kaynak yetersizse hukuki sonucu kesinleştirmemek gerekir.")).toBe(false);
    expect(matchesDomainRisk("education", "Öğrenciye özel kesin karar vermeden önce okul bilgisi netleştirilmelidir.")).toBe(false);
    expect(matchesDomainRisk("education", "Kaynakta açık dayanak yoksa kesin başarı çıkarılmamalıdır.")).toBe(false);
  });

  it("detects financial guarantees and direct buy/sell commands", () => {
    expect(matchesDomainRisk("finance", "Bu hissede kesin al, garantili getiri var.")).toBe(true);
    expect(getDomainSafetyPolicy("finance").requiredGuidanceTerms).toContain("risk");
  });

  it("detects destructive technical certainty around production changes", () => {
    expect(matchesDomainRisk("technical", "Productionda doğrudan drop çalıştır, rollbacke gerek yok.")).toBe(true);
    expect(getDomainSafetyPolicy("technical").requiredGuidanceTerms).toContain("rollback");
  });

  it("detects unsupported education certainty", () => {
    expect(matchesDomainRisk("education", "Bu sınavda kesin geçersin.")).toBe(true);
    expect(getDomainSafetyPolicy("education").requiredGuidanceTerms).toContain("okul");
  });
});
