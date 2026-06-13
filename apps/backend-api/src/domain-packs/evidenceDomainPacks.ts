export type EvidenceDomainPackKind = "table_numeric" | "lexical_hint";

export interface EvidenceDomainFieldAlias {
  fieldId: string;
  label: string;
  aliases: string[];
  valueType?: "money" | "number" | "percentage" | "text";
}

export interface EvidenceDomainPack {
  id: string;
  version: string;
  domain: string;
  kind: EvidenceDomainPackKind;
  artifactKinds: string[];
  requestedFieldAliases: EvidenceDomainFieldAlias[];
}

const FINANCE_PROFIT_DISTRIBUTION_PACK: EvidenceDomainPack = {
  id: "finance-profit-distribution",
  version: "1.0",
  domain: "finance",
  kind: "table_numeric",
  artifactKinds: ["table_cell", "table_row", "numeric_value"],
  requestedFieldAliases: [
    {
      fieldId: "net_donem_kari",
      label: "Net Dönem Kârı",
      aliases: ["net dönem kârı", "net profit for the period"],
      valueType: "money",
    },
    {
      fieldId: "donem_kari",
      label: "Dönem Kârı",
      aliases: ["dönem kârı", "profit for the period"],
      valueType: "money",
    },
    {
      fieldId: "dagitilmasi_ongorulen_diger_kaynaklar",
      label: "Dağıtılması Öngörülen Diğer Kaynaklar",
      aliases: ["dağıtılması öngörülen diğer kaynaklar", "other sources planned for distribution"],
      valueType: "money",
    },
  ],
};

const PACKS = [FINANCE_PROFIT_DISTRIBUTION_PACK] as const;

export function listEvidenceDomainPacks(): EvidenceDomainPack[] {
  return [...PACKS];
}

export function findEvidenceDomainPacksForText(text: string): EvidenceDomainPack[] {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return PACKS.filter((pack) =>
    pack.requestedFieldAliases.some((field) =>
      [field.label, ...field.aliases].some((alias) => normalized.includes(alias.toLocaleLowerCase("tr-TR"))),
    ),
  );
}
