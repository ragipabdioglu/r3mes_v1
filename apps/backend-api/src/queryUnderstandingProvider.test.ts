import { describe, expect, it } from "vitest";

import {
  isValidDomainLexiconPack,
  summarizeDomainLexiconPack,
  validateDomainLexiconPack,
  type DomainLexiconPack,
} from "./lib/domainLexiconPack.js";
import {
  getHeuristicQueryUnderstandingProviderDescriptor,
  HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_ID,
  summarizeQueryUnderstandingProviderDescriptor,
} from "./lib/queryUnderstandingProvider.js";

describe("query understanding provider boundary", () => {
  it("describes the current heuristic behavior without binding to the implementation", () => {
    const descriptor = getHeuristicQueryUnderstandingProviderDescriptor();

    expect(descriptor.id).toBe(HEURISTIC_TR_V1_QUERY_UNDERSTANDING_PROVIDER_ID);
    expect(descriptor.status).toBe("boundary_only");
    expect(descriptor.capabilities).toEqual(
      expect.arrayContaining(["concept_rules", "route_rules", "requested_field_aliases"]),
    );
    expect(summarizeQueryUnderstandingProviderDescriptor(descriptor)).toMatchObject({
      id: "heuristic-tr-v1",
      locale: "tr",
      implementation: "heuristic",
      status: "boundary_only",
    });
  });

  it("validates and summarizes a domain lexicon pack", () => {
    const pack: DomainLexiconPack = {
      id: "kap-finance-v1",
      locale: "tr",
      version: "1.0.0",
      concepts: [
        {
          id: "concept-net-profit",
          canonicalConcept: "net_donem_kari",
          aliases: ["net dönem karı", "net donem kari"],
        },
      ],
      routeRules: [
        {
          id: "route-finance-table",
          target: "knowledge_lookup",
          terms: ["kar payı", "temettü"],
          domain: "finance",
        },
      ],
      requestedFieldAliases: [
        {
          id: "field-net-profit",
          fieldId: "net_donem_kari",
          label: "Net Dönem Kârı",
          aliases: ["net dönem karı", "net profit for the period"],
          outputHint: "number",
        },
      ],
    };

    expect(validateDomainLexiconPack(pack)).toEqual([]);
    expect(isValidDomainLexiconPack(pack)).toBe(true);
    expect(summarizeDomainLexiconPack(pack)).toMatchObject({
      id: "kap-finance-v1",
      locale: "tr",
      version: "1.0.0",
      conceptRuleCount: 1,
      routeRuleCount: 1,
      requestedFieldAliasCount: 1,
      conceptIds: ["concept-net-profit"],
      routeRuleIds: ["route-finance-table"],
      requestedFieldIds: ["net_donem_kari"],
    });
  });

  it("reports structural pack issues without throwing", () => {
    const pack: DomainLexiconPack = {
      id: "",
      locale: "tr",
      concepts: [
        { id: "duplicate", canonicalConcept: "", aliases: [] },
        { id: "duplicate", canonicalConcept: "net_donem_kari", aliases: ["net dönem karı"] },
      ],
      routeRules: [{ id: "route", target: "knowledge_lookup", terms: [] }],
      requestedFieldAliases: [{ id: "field", fieldId: "", label: "Net Dönem Kârı", aliases: [] }],
    };

    const issues = validateDomainLexiconPack(pack);

    expect(isValidDomainLexiconPack(pack)).toBe(false);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "required_string_missing",
        "required_aliases_missing",
        "duplicate_rule_id",
      ]),
    );
  });
});
