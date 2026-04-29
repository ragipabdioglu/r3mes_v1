import { describe, expect, it } from "vitest";

import { normalizeKnowledgeChunkContent } from "./knowledgeNormalize.js";

describe("normalizeKnowledgeChunkContent", () => {
  it("wraps raw legal text into a generic evidence card", () => {
    const normalized = normalizeKnowledgeChunkContent(
      "Kira sözleşmesinin feshi için bildirim süresi ve sözleşme hükümleri önemlidir. Hak kaybı riski varsa avukata danışılmalıdır.",
      { title: "Kira notu" },
    );

    expect(normalized).toContain("Topic: Kira notu");
    expect(normalized).toContain("Tags: legal");
    expect(normalized).toContain("Source Summary:");
    expect(normalized).toContain("Key Takeaway:");
    expect(normalized).toContain("Safe Guidance:");
    expect(normalized).toContain("Do Not Infer:");
    expect(normalized).toContain("kesin dava sonucu");
  });

  it("keeps already structured cards unchanged", () => {
    const card = `Topic: HPV takip
Tags: medical, hpv
Patient Summary: HPV pozitif sonucu soruluyor.
Clinical Takeaway: HPV pozitifliği tek başına kanser anlamına gelmez.
Safe Guidance: Doktor kontrolü gerekir.
Red Flags: Anormal kanama varsa başvurulmalıdır.
Do Not Infer: Kesin kanser deme.`;

    expect(normalizeKnowledgeChunkContent(card)).toBe(card);
  });
});
