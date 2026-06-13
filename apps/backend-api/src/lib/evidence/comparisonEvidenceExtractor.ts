import { cardText, overlapsQuery, sourceEvidenceItem, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const COMPARISON_MARKERS = /\b(?:fark|farklı|ayrı|ancak|ama|ise|göre|kıyas|karşılaştır|whereas|while|unlike|compared)\b/iu;

export function extractComparisonEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  return splitSentences(cardText(input.card))
    .filter((sentence) => COMPARISON_MARKERS.test(sentence) && overlapsQuery({ text: sentence, queryTokens: input.queryTokens }))
    .slice(0, 8)
    .map((quote) =>
      sourceEvidenceItem({
        kind: "comparison_point",
        extractor: "comparison-evidence-v2",
        extraction: input,
        quote,
        confidence: "high",
      }),
    );
}
