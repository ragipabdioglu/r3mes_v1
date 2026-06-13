import { cardText, overlapsQuery, sourceEvidenceItem, splitCodeBlocks, splitSentences, type ArtifactExtractionInput } from "./evidenceExtractorShared.js";
import type { EvidenceItem } from "../evidenceBundle.js";

const CODE_MARKERS = /\b(?:function|class|const|let|var|return|if|else|for|while|async|await|private|public|void|def|import|export)\b|[A-Za-z_$][\w$]*\s*\(/u;

export function extractCodeEvidence(input: ArtifactExtractionInput): EvidenceItem[] {
  const text = cardText(input.card);
  const blocks = splitCodeBlocks(text);
  const snippets = blocks.length > 0 ? blocks : splitSentences(text).filter((sentence) => CODE_MARKERS.test(sentence));
  return snippets
    .filter((snippet) => overlapsQuery({ text: snippet, queryTokens: input.queryTokens }) || CODE_MARKERS.test(snippet))
    .slice(0, 8)
    .map((quote) =>
      sourceEvidenceItem({
        kind: "code_fact",
        extractor: "code-evidence-v2",
        extraction: input,
        quote,
        confidence: CODE_MARKERS.test(quote) ? "high" : "medium",
      }),
    );
}
