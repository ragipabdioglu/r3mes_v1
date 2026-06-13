import { cardText, overlapsQuery, sourceEvidenceItem, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

export function extractTextClaimEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  return splitSentences(cardText(input.card))
    .filter((sentence) => overlapsQuery({ text: sentence, queryTokens: input.queryTokens, min: 1 }))
    .slice(0, 8)
    .map((quote) =>
      sourceEvidenceItem({
        kind: "text_fact",
        extractor: "text-claim-evidence-v2",
        extraction: input,
        quote,
        confidence: "medium",
      }),
    );
}
