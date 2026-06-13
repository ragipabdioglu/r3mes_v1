import { cardText, overlapsQuery, sourceEvidenceItem, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const DEFINITION_MARKERS = /\b(?:nedir|tanım|tanimi|tanımı|denir|ifade eder|olarak adlandırılır|is defined as|refers to)\b/iu;

export function extractDefinitionEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  const text = cardText(input.card);
  const sentences = splitSentences(text);
  const matches = sentences
    .filter((sentence) => DEFINITION_MARKERS.test(sentence) || overlapsQuery({ text: sentence, queryTokens: input.queryTokens, min: 2 }))
    .slice(0, 4);
  return matches.map((quote) =>
    sourceEvidenceItem({
      kind: "definition",
      extractor: "definition-evidence-v2",
      extraction: input,
      quote,
      confidence: DEFINITION_MARKERS.test(quote) ? "high" : "medium",
    }),
  );
}
