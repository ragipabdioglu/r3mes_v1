import { cardText, overlapsQuery, sourceEvidenceItem, splitListItems, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const PROCEDURE_MARKERS = /\b(?:adım|step|önce|sonra|ardından|sırasıyla|ayarlanır|eklenir|temizlenir|kontrol edilir|yapılır|kullanılır)\b/iu;

export function extractProcedureEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  const text = cardText(input.card);
  const candidates = [...splitListItems(text), ...splitSentences(text)]
    .filter((item) => PROCEDURE_MARKERS.test(item) || overlapsQuery({ text: item, queryTokens: input.queryTokens, min: 2 }))
    .slice(0, 10);
  return candidates.map((quote) =>
    sourceEvidenceItem({
      kind: "procedure_step",
      extractor: "procedure-evidence-v2",
      extraction: input,
      quote,
      confidence: PROCEDURE_MARKERS.test(quote) ? "high" : "medium",
    }),
  );
}
