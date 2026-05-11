import { describe, expect, it } from "vitest";

import { scoreKnowledgeParseQuality } from "./knowledgeParseQuality.js";
import { chunkKnowledgeText } from "./knowledgeText.js";

describe("scoreKnowledgeParseQuality", () => {
  it("scores structured markdown as clean", () => {
    const text = [
      "# Clinical Card",
      "Topic: baş ağrısı triyaj",
      "Tags: baş ağrısı, ateş, acil",
      "Summary: Baş ağrısı tek başına çoğu zaman acil değildir, ancak nörolojik bulgu, yüksek ateş veya ani şiddetli başlangıç varsa sağlık uzmanına başvurulmalıdır.",
      "",
      "- Kısa süreli hafif ağrı takip edilebilir.",
      "- Şiddetli ve ani ağrı acil değerlendirme gerektirir.",
    ].join("\n");

    const quality = scoreKnowledgeParseQuality({
      filename: "clinical-card.md",
      sourceType: "MARKDOWN",
      text,
      chunks: chunkKnowledgeText(text),
    });

    expect(quality.level).toBe("clean");
    expect(quality.score).toBeGreaterThanOrEqual(76);
    expect(quality.warnings).not.toContain("mojibake_detected");
  });

  it("flags mojibake and replacement characters as noisy", () => {
    const text = [
      "# Jinekolojik Onkoloji Bilgi KaydÄ±",
      "Soru: KasÄ±k aÄrÄ±m oluyor ve akÄ±ntÄ± var �",
      "Cevap: Muayene ile deÄerlendirme gerekir. Ã‡ok kÄ±sa not.",
    ].join("\n");

    const quality = scoreKnowledgeParseQuality({
      filename: "broken.md",
      sourceType: "MARKDOWN",
      text,
      chunks: chunkKnowledgeText(text),
    });

    expect(quality.level).toBe("noisy");
    expect(quality.warnings).toContain("replacement_char_detected");
    expect(quality.warnings).toContain("mojibake_detected");
  });

  it("keeps plain text usable when it is long enough", () => {
    const text = [
      "Production migration öncesinde yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
      "İşlem sırasında kilit süreleri ve loglar izlenmeli, veri silen komutlar ayrıca gözden geçirilmelidir.",
      "Kritik tablolar için doğrulanabilir küçük adımlar tercih edilmelidir.",
    ].join("\n\n");

    const quality = scoreKnowledgeParseQuality({
      filename: "runbook.txt",
      sourceType: "TEXT",
      text,
      chunks: chunkKnowledgeText(text),
    });

    expect(quality.level).toBe("usable");
    expect(quality.score).toBeGreaterThanOrEqual(48);
  });

  it("keeps table-like financial content visible as a parse signal", () => {
    const text = [
      "# KAP Finansal Tablo",
      "| Kalem | 2024 | 2025 | Değişim |",
      "| Hasılat | 1.250.000 TL | 1.640.000 TL | %31 |",
      "| Net kar | 220.000 TL | 305.000 TL | %39 |",
      "Şirket hasılat ve net kar değişimini finansal tablo içinde açıklamıştır.",
    ].join("\n");

    const quality = scoreKnowledgeParseQuality({
      filename: "kap-table.md",
      sourceType: "MARKDOWN",
      text,
      chunks: chunkKnowledgeText(text),
    });

    expect(quality.signals.tableSignalCount).toBeGreaterThanOrEqual(2);
    expect(quality.signals.numericDensity).toBeGreaterThan(0.05);
    expect(quality.warnings).toContain("table_like_content");
  });

  it("flags dense numeric text without table structure as a parsing risk", () => {
    const text = [
      "2024 1250000 1640000 31 2025 220000 305000 39 2023 980000 1100000 12 2022 800000 930000 16",
      "Bu metinde sayılar art arda gelmektedir ancak başlık, satır veya tablo ayrımı yeterince açık değildir.",
      "Açıklama kullanıcıya aktarılmadan önce kaynak bağlamının dikkatli kontrol edilmesi gerekir.",
    ].join("\n").repeat(3);

    const quality = scoreKnowledgeParseQuality({
      filename: "ocr-numbers.txt",
      sourceType: "TEXT",
      text,
      chunks: chunkKnowledgeText(text),
    });

    expect(quality.signals.numericDensity).toBeGreaterThan(0.18);
    expect(quality.warnings).toContain("dense_numbers_without_table_structure");
  });
});
