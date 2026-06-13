import { cardText, sourceEvidenceItem, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const SOURCE_LIMIT_MARKERS = /\b(?:kaynakta yok|belirtilmiyor|dayanak yok|çıkarma|cikarma|kapsam dışı|kapsam disi|not infer|not supported|not available|no evidence)\b/iu;

export function extractSourceLimitEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  return splitSentences(cardText(input.card))
    .filter((sentence) => SOURCE_LIMIT_MARKERS.test(sentence))
    .slice(0, 6)
    .map((quote) =>
      sourceEvidenceItem({
        kind: "source_limit",
        extractor: "source-limit-evidence-v2",
        extraction: input,
        quote,
        confidence: "medium",
      }),
    );
}
