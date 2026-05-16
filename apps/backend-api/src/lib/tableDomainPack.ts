import type { TableFactValueType } from "./tableFact.js";

export interface TableDomainFieldAlias {
  fieldId: string;
  label: string;
  aliases: string[];
  valueType?: TableFactValueType;
  requiredHeaders?: string[];
  excludedHeaders?: string[];
}

export interface TableDomainPack {
  id: string;
  version: string;
  locale?: string;
  domain: string;
  description?: string;
  fieldAliases: TableDomainFieldAlias[];
  tableTitleAliases?: string[];
  sourceHints?: string[];
}

export function findTableDomainFieldAliases(
  packs: TableDomainPack[],
  fieldId: string,
): Array<TableDomainFieldAlias & { domainPackId: string }> {
  return packs.flatMap((pack) =>
    pack.fieldAliases
      .filter((alias) => alias.fieldId === fieldId)
      .map((alias) => ({
        ...alias,
        domainPackId: pack.id,
      })),
  );
}

export function listTableDomainPackIds(packs: TableDomainPack[]): string[] {
  return packs.map((pack) => pack.id);
}
