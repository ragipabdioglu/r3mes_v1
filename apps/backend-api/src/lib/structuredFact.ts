export type StructuredFactKind = "table_cell" | "table_row" | "numeric_value" | "text_claim";

export type StructuredFactConfidence = "low" | "medium" | "high";

export interface StructuredFact {
  id: string;
  kind: StructuredFactKind;
  sourceId: string;
  chunkId?: string;
  subject?: string;
  field?: string;
  value?: string;
  unit?: string;
  period?: string;
  confidence: StructuredFactConfidence;
  table?: {
    title?: string;
    rowLabel?: string;
    columnLabel?: string;
    headers?: string[];
    rawRow?: string;
  };
  provenance: {
    quote: string;
    extractor: string;
  };
}
