import { describe, expect, it } from "vitest";

import { fieldTextMatchesFact, requestedFieldMatchesFact } from "./fieldCoverageResolver.js";
import type { RequestedField } from "./requestedFieldDetector.js";
import type { StructuredFact } from "./structuredFact.js";

function fact(overrides: Partial<StructuredFact> = {}): StructuredFact {
  return {
    id: "fact-1",
    kind: "numeric_value",
    sourceId: "source-1",
    field: "Total Amount",
    value: "120",
    confidence: "high",
    provenance: {
      quote: "Total amount is listed as 120 in the source table.",
      extractor: "test",
    },
    ...overrides,
  };
}

function requestedField(overrides: Partial<RequestedField> = {}): RequestedField {
  return {
    id: "total_amount",
    label: "Total amount",
    aliases: ["amount total"],
    required: true,
    outputHint: "number",
    confidence: "high",
    matchedAliases: [],
    ...overrides,
  };
}

describe("fieldCoverageResolver", () => {
  it("matches snake-case requested ids to human-readable fact fields", () => {
    expect(fieldTextMatchesFact("total_amount", fact({ field: "Total Amount" }))).toBe(true);
  });

  it("matches requested fields against table row labels and provenance", () => {
    const structuredFact = fact({
      field: undefined,
      table: {
        rowLabel: "Net payable value",
        columnLabel: "Current period",
        rawRow: "Net payable value 120",
      },
      provenance: {
        quote: "Net payable value 120",
        extractor: "test",
      },
    });

    expect(requestedFieldMatchesFact(requestedField({ id: "net_payable_value", label: "Net payable value" }), structuredFact))
      .toBe(true);
  });

  it("does not match unrelated requested fields just because evidence is structured", () => {
    expect(fieldTextMatchesFact("secondary_amount", fact({ field: "Total Amount" }))).toBe(false);
  });

  it("uses aliases without needing data-specific literals", () => {
    const structuredFact = fact({ field: "Current period value" });
    expect(requestedFieldMatchesFact(
      requestedField({
        id: "primary_measure",
        label: "Primary measure",
        aliases: ["current period value"],
      }),
      structuredFact,
    )).toBe(true);
  });
});
