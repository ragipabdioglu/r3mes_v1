import { describe, expect, it, vi } from "vitest";
import * as rerankModule from "./rerank.js";
import * as modelRerankModule from "./modelRerank.js";

describe("rerankKnowledgeCardsWithFallback", () => {
  it("falls back to deterministic ranking when model reranker is disabled", async () => {
    const candidates = [
      {
        fusedScore: 1,
        lexicalScore: 1,
        embeddingScore: 0,
        chunk: { id: "good" },
        card: {
          topic: "smear sonucu",
          tags: ["smear"],
          patientSummary: "Smear sonucu temiz.",
          clinicalTakeaway: "Temiz smear iyi bir bulgudur.",
          safeGuidance: "Şikayet sürerse muayene gerekir.",
          redFlags: "Şiddetli ağrı olursa değerlendirme gerekir.",
          doNotInfer: "",
        },
      },
    ];

    vi.stubEnv("R3MES_RERANKER_MODE", "deterministic");
    const ranked = await modelRerankModule.rerankKnowledgeCardsWithFallback(
      "Smear sonucum temiz çıktı ama kasık ağrım oluyor.",
      candidates,
      1,
    );

    expect(ranked).toEqual(
      rerankModule.rerankKnowledgeCards(
        "Smear sonucum temiz çıktı ama kasık ağrım oluyor.",
        candidates,
        1,
      ),
    );
    vi.unstubAllEnvs();
  });
});
