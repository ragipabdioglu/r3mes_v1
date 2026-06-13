import { cardText, overlapsQuery, sourceEvidenceItem, splitListItems, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const VISUAL_MARKERS = /\b(?:görsel|gorsel|layout|arayüz|arayuz|tasarım|tasarim|ekran|form|panel|bbox|figure|caption)\b/iu;

export function extractVisualLayoutEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  const candidates = [...splitListItems(cardText(input.card)), ...splitSentences(cardText(input.card))]
    .filter((item) => VISUAL_MARKERS.test(item) || overlapsQuery({ text: item, queryTokens: input.queryTokens, min: 2 }))
    .slice(0, 10);
  return candidates.map((quote) =>
    sourceEvidenceItem({
      kind: "visual_layout",
      extractor: "visual-layout-evidence-v2",
      extraction: input,
      quote,
      confidence: VISUAL_MARKERS.test(quote) ? "medium" : "low",
    }),
  );
}
