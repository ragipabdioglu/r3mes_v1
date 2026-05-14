import { normalizeConceptText } from "./conceptNormalizer.js";
import { getDecisionConfig } from "./decisionConfig.js";

export function normalizedIncludesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalizeConceptText(term)));
}

export function getEvidenceLexicon() {
  const lexicon = getDecisionConfig().evidenceLexicon;
  return {
    shareGroupTerms: lexicon.shareGroupTerms.map(normalizeConceptText),
    cashRateTerms: lexicon.cashRateTerms.map(normalizeConceptText),
    withholdingTerms: lexicon.withholdingTerms.map(normalizeConceptText),
    spkTerms: lexicon.spkTerms.map(normalizeConceptText),
    otherSourcesTerms: lexicon.otherSourcesTerms.map(normalizeConceptText),
    netPeriodTerms: lexicon.netPeriodTerms.map(normalizeConceptText),
    periodProfitTerms: lexicon.periodProfitTerms.map(normalizeConceptText),
    distributableTerms: lexicon.distributableTerms.map(normalizeConceptText),
  };
}

