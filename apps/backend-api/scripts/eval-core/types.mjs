export const EVAL_CONTRACT_V2_VERSION = 2;

/**
 * @typedef {Object} EvalModes
 * @property {boolean} answer
 * @property {boolean} evidence
 * @property {boolean} safety
 * @property {boolean} debug
 * @property {boolean} runtime
 */

/**
 * @typedef {Object} EvidenceExpectations
 * @property {boolean=} mustHaveSources
 * @property {number=} minSources
 * @property {number=} maxSources
 * @property {number=} minEvidenceFacts
 * @property {number=} minEvidenceBundleItemCount
 * @property {string[]=} expectedConfidence
 * @property {string[]=} expectedSourceTerms
 * @property {string[]=} requiredSourceTerms
 * @property {string[]=} expectedTitleTerms
 * @property {string[]=} requiredTitleTerms
 * @property {string[]=} requiredContextTerms
 * @property {string[]=} forbiddenContextTerms
 * @property {string[]=} requiredEvidenceTerms
 * @property {string[]=} forbiddenEvidenceTerms
 * @property {string[]=} requiredNotSupportedTerms
 * @property {string=} expectedEvidenceType
 * @property {string=} requiredEvidenceType
 * @property {string[]=} allowedEvidenceTypes
 * @property {string=} expectedCompiledEvidenceConfidence
 * @property {number=} minCompiledEvidenceContradictionCount
 */

/**
 * @typedef {Object} AnswerExpectations
 * @property {string[]=} requiredConcepts
 * @property {string[]=} requiredAnswerTerms
 * @property {string[]=} forbiddenAnswerTerms
 * @property {string[]=} forbiddenTerms
 * @property {number=} maxAnswerWords
 * @property {number=} maxAnswerChars
 * @property {boolean=} mustNotHaveLowLanguageQuality
 * @property {boolean=} mustNotUseGenericCaution
 */

/**
 * @typedef {Object} EvalContractV2
 * @property {EvalModes} evalModes
 * @property {EvidenceExpectations} evidenceExpectations
 * @property {AnswerExpectations} answerExpectations
 */
