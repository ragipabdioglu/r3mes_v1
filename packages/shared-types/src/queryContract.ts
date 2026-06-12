export type QueryContractOperation =
  | "conversation"
  | "answer"
  | "define"
  | "list"
  | "compare"
  | "summarize"
  | "procedure"
  | "code_explanation"
  | "visual_layout"
  | "extract_fields"
  | "explain_with_sources"
  | "unknown";

export type QueryContractRequiredEvidenceType =
  | "none"
  | "source"
  | "structured_fields"
  | "source_and_structured_fields"
  | "visual_layout"
  | "unknown";

export type QueryContractOutputFormat = "bullets" | "short" | "table" | "freeform";

export type QueryContractFieldOutputHint = "number" | "text" | "bullet" | "table";

export type QueryContractConfidence = "low" | "medium" | "high";

export type QueryContractQualityShape = "empty" | "short" | "normal" | "noisy";

export interface QueryContractRequestedField {
  id: string;
  label: string;
  required: boolean;
  outputHint: QueryContractFieldOutputHint;
  confidence: QueryContractConfidence;
}

export interface QueryContractQuality {
  shape: QueryContractQualityShape;
  clarityScore: number;
  tokenCount: number;
  expandedTokenCount: number;
  conceptCount: number;
  profileConceptCount: number;
  weakSignalCount: number;
}

export interface QueryContractOutputConstraints {
  maxWords?: number;
  maxSentencesPerBullet?: number;
  forbidCaution: boolean;
  noRawTableDump: boolean;
  format: QueryContractOutputFormat;
  sourceGroundedOnly: boolean;
}

export interface QueryContract {
  operation: QueryContractOperation;
  requiredEvidenceType: QueryContractRequiredEvidenceType;
  outputFormat: QueryContractOutputFormat;
  outputConstraints: QueryContractOutputConstraints;
  sourceOnly: boolean;
  requestedFields: QueryContractRequestedField[];
  forbiddenAdditions: string[];
  queryQuality: QueryContractQuality;
}
