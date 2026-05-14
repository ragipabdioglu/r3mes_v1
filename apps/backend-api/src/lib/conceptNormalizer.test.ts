import { describe, expect, it } from "vitest";

import { expandSurfaceConceptTerms, expandSurfaceTokenVariants } from "./conceptNormalizer.js";

describe("conceptNormalizer", () => {
  it("keeps router surface variants narrower than retrieval concept expansions", () => {
    const surface = expandSurfaceTokenVariants("Özel eğitim için RAM raporu");
    const concepts = expandSurfaceConceptTerms("Özel eğitim için RAM raporu");

    expect(surface).toEqual(expect.arrayContaining(["egitim", "rapor"]));
    expect(surface).not.toContain("rehberlik");
    expect(concepts).toContain("rehberlik");
  });

  it("does not create ambiguous short stems from everyday Turkish words", () => {
    const surface = expandSurfaceTokenVariants("Bugün kısa bir not yazabilir misin?");

    expect(surface).toContain("bugun");
    expect(surface).not.toContain("bug");
  });

  it("expands colloquial Turkish verb endings without domain-specific query rules", () => {
    const surface = expandSurfaceTokenVariants("agriyo ilerliyom bakiyon agriyorrr");

    expect(surface).toEqual(expect.arrayContaining(["agriyor", "ilerliyorum", "bakiyorsun"]));
    expect(surface).toContain("agriyor");
  });
});
