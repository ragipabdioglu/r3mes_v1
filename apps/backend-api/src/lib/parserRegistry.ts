export type KnowledgeSourceType = "TEXT" | "MARKDOWN" | "JSON" | "PDF" | "DOCX" | "PPTX" | "HTML";
export type KnowledgeParserInputMode = "utf8" | "binary";
export type KnowledgeExternalParserProfile = "docling" | "marker" | "external";
export type KnowledgeParserHealth = "ready" | "degraded" | "unavailable";

export interface KnowledgeParserAdapter<TParsedDocument = unknown> {
  id: string;
  version: number;
  sourceType: KnowledgeSourceType;
  sourceTypeForFilename?: (filename: string) => KnowledgeSourceType;
  extensions: string[];
  inputMode: KnowledgeParserInputMode;
  parse(opts: { filename: string; buffer: Buffer; raw: string }): TParsedDocument;
}

export interface KnowledgeParserCapability {
  id: string;
  version: number;
  sourceType: KnowledgeSourceType;
  sourceTypes: KnowledgeSourceType[];
  extensions: string[];
  mimeTypes: string[];
  inputMode: KnowledgeParserInputMode;
  available: boolean;
  kind: "built_in" | "external";
  health: KnowledgeParserHealth;
  priority: number;
  supportsTables: boolean;
  supportsOcr: boolean;
  supportsSpreadsheets: boolean;
  outputSchemaVersion: number;
  profile?: KnowledgeExternalParserProfile | null;
  reason?: string | null;
}

export interface KnowledgeParserRegistryEntry<TParsedDocument = unknown> {
  adapter?: KnowledgeParserAdapter<TParsedDocument> | null;
  capability: KnowledgeParserCapability;
}

export interface KnowledgeParserRegistry<TParsedDocument = unknown> {
  listAdapters(): Array<Pick<KnowledgeParserAdapter<TParsedDocument>, "id" | "version" | "sourceType" | "extensions">>;
  listCapabilities(): KnowledgeParserCapability[];
  getForExtension(extension: string): KnowledgeParserAdapter<TParsedDocument> | null;
  supportsExtension(extension: string): boolean;
}

export function createKnowledgeParserRegistry<TParsedDocument>(
  entries: KnowledgeParserRegistryEntry<TParsedDocument>[],
): KnowledgeParserRegistry<TParsedDocument> {
  const adapters = entries
    .map((entry) => entry.adapter)
    .filter((adapter): adapter is KnowledgeParserAdapter<TParsedDocument> => Boolean(adapter));

  return {
    listAdapters: () => adapters.map((parser) => ({
      id: parser.id,
      version: parser.version,
      sourceType: parser.sourceType,
      extensions: [...parser.extensions],
    })),
    listCapabilities: () => entries.map((entry) => ({
      ...entry.capability,
      sourceTypes: [...entry.capability.sourceTypes],
      extensions: [...entry.capability.extensions],
      mimeTypes: [...entry.capability.mimeTypes],
    })),
    getForExtension: (extension) => adapters.find((parser) => parser.extensions.includes(extension)) ?? null,
    supportsExtension: (extension) => adapters.some((parser) => parser.extensions.includes(extension)),
  };
}
