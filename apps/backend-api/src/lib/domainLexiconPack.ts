export type DomainLexiconSeverity = "info" | "warning" | "error";

export interface DomainLexiconValidationIssue {
  severity: DomainLexiconSeverity;
  code: string;
  message: string;
  path: string;
}

export type ConceptRuleMatchMode = "exact" | "contains" | "token_overlap" | "fuzzy";

export interface ConceptRule {
  id: string;
  canonicalConcept: string;
  aliases: string[];
  locale?: string;
  matchMode?: ConceptRuleMatchMode;
  weight?: number;
  tags?: string[];
  description?: string;
}

export type RouteRuleTarget =
  | "knowledge_lookup"
  | "source_selection"
  | "conversation"
  | "unclear";

export interface RouteRule {
  id: string;
  target: RouteRuleTarget;
  terms: string[];
  negativeTerms?: string[];
  domain?: string;
  confidence?: "low" | "medium" | "high";
  weight?: number;
  tags?: string[];
  description?: string;
}

export type RequestedFieldAliasOutputHint = "number" | "text" | "bullet" | "table";

export interface RequestedFieldAlias {
  id: string;
  fieldId: string;
  label: string;
  aliases: string[];
  outputHint?: RequestedFieldAliasOutputHint;
  required?: boolean;
  tableHeaderHints?: string[];
  valueType?: "money" | "number" | "date" | "text" | "percentage";
  tags?: string[];
  description?: string;
}

export interface DomainLexiconPack {
  id: string;
  locale: string;
  version?: string;
  description?: string;
  concepts: ConceptRule[];
  routeRules: RouteRule[];
  requestedFieldAliases: RequestedFieldAlias[];
  tags?: string[];
}

export interface DomainLexiconPackSummary {
  id: string;
  locale: string;
  version: string | null;
  conceptRuleCount: number;
  routeRuleCount: number;
  requestedFieldAliasCount: number;
  conceptIds: string[];
  routeRuleIds: string[];
  requestedFieldIds: string[];
  tags: string[];
}

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function pushRequiredStringIssue(
  issues: DomainLexiconValidationIssue[],
  value: string | undefined,
  path: string,
): void {
  if (!isBlank(value)) return;
  issues.push({
    severity: "error",
    code: "required_string_missing",
    message: `${path} must be a non-empty string.`,
    path,
  });
}

function pushRequiredArrayIssue(
  issues: DomainLexiconValidationIssue[],
  values: string[] | undefined,
  path: string,
): void {
  if (Array.isArray(values) && values.some((value) => !isBlank(value))) return;
  issues.push({
    severity: "error",
    code: "required_aliases_missing",
    message: `${path} must contain at least one non-empty string.`,
    path,
  });
}

function pushDuplicateIdIssue(
  issues: DomainLexiconValidationIssue[],
  ids: string[],
  path: string,
): void {
  if (!hasDuplicate(ids)) return;
  issues.push({
    severity: "error",
    code: "duplicate_rule_id",
    message: `${path} contains duplicate IDs.`,
    path,
  });
}

export function validateDomainLexiconPack(pack: DomainLexiconPack): DomainLexiconValidationIssue[] {
  const issues: DomainLexiconValidationIssue[] = [];

  pushRequiredStringIssue(issues, pack.id, "id");
  pushRequiredStringIssue(issues, pack.locale, "locale");

  pack.concepts.forEach((rule, index) => {
    const path = `concepts[${index}]`;
    pushRequiredStringIssue(issues, rule.id, `${path}.id`);
    pushRequiredStringIssue(issues, rule.canonicalConcept, `${path}.canonicalConcept`);
    pushRequiredArrayIssue(issues, rule.aliases, `${path}.aliases`);
  });

  pack.routeRules.forEach((rule, index) => {
    const path = `routeRules[${index}]`;
    pushRequiredStringIssue(issues, rule.id, `${path}.id`);
    pushRequiredStringIssue(issues, rule.target, `${path}.target`);
    pushRequiredArrayIssue(issues, rule.terms, `${path}.terms`);
  });

  pack.requestedFieldAliases.forEach((field, index) => {
    const path = `requestedFieldAliases[${index}]`;
    pushRequiredStringIssue(issues, field.id, `${path}.id`);
    pushRequiredStringIssue(issues, field.fieldId, `${path}.fieldId`);
    pushRequiredStringIssue(issues, field.label, `${path}.label`);
    pushRequiredArrayIssue(issues, field.aliases, `${path}.aliases`);
  });

  pushDuplicateIdIssue(issues, pack.concepts.map((rule) => rule.id), "concepts");
  pushDuplicateIdIssue(issues, pack.routeRules.map((rule) => rule.id), "routeRules");
  pushDuplicateIdIssue(issues, pack.requestedFieldAliases.map((field) => field.id), "requestedFieldAliases");

  return issues;
}

export function isValidDomainLexiconPack(pack: DomainLexiconPack): boolean {
  return validateDomainLexiconPack(pack).every((issue) => issue.severity !== "error");
}

export function summarizeDomainLexiconPack(pack: DomainLexiconPack): DomainLexiconPackSummary {
  return {
    id: pack.id,
    locale: pack.locale,
    version: pack.version ?? null,
    conceptRuleCount: pack.concepts.length,
    routeRuleCount: pack.routeRules.length,
    requestedFieldAliasCount: pack.requestedFieldAliases.length,
    conceptIds: pack.concepts.map((rule) => rule.id),
    routeRuleIds: pack.routeRules.map((rule) => rule.id),
    requestedFieldIds: pack.requestedFieldAliases.map((field) => field.fieldId),
    tags: pack.tags ?? [],
  };
}
