import { cardText, overlapsQuery, sourceEvidenceItem, splitListItems, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

export function extractListEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  const text = cardText(input.card);
  const listItems = splitListItems(text);
  const directItems = listItems.filter((item) => overlapsQuery({ text: item, queryTokens: input.queryTokens }) || listItems.length >= 3);
  const sentenceItems = directItems.length > 0
    ? []
    : splitSentences(text).filter((sentence) => /[,;:]\s*[^,;:]+[,;]/u.test(sentence) && overlapsQuery({ text: sentence, queryTokens: input.queryTokens }));
  return [...directItems, ...sentenceItems].slice(0, 12).map((quote) =>
    sourceEvidenceItem({
      kind: "list_item",
      extractor: "list-evidence-v2",
      extraction: input,
      quote,
      confidence: directItems.includes(quote) ? "high" : "medium",
    }),
  );
}
