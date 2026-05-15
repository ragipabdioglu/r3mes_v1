import { afterEach, describe, expect, it } from "vitest";

import {
  getKnowledgeParserForFilename,
  isSupportedKnowledgeFilename,
  listKnowledgeParserAdapters,
  listKnowledgeParserCapabilities,
  normalizeParsedKnowledgeText,
  chunkKnowledgeText,
  chunkParsedKnowledgeDocument,
  parseKnowledgeBuffer,
} from "./knowledgeText.js";

describe("knowledge parser adapters", () => {
  const originalParserCommand = process.env.R3MES_DOCUMENT_PARSER_COMMAND;
  const originalParserArgs = process.env.R3MES_DOCUMENT_PARSER_ARGS;
  const originalParserProfile = process.env.R3MES_DOCUMENT_PARSER_PROFILE;

  afterEach(() => {
    if (originalParserCommand === undefined) delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    else process.env.R3MES_DOCUMENT_PARSER_COMMAND = originalParserCommand;
    if (originalParserArgs === undefined) delete process.env.R3MES_DOCUMENT_PARSER_ARGS;
    else process.env.R3MES_DOCUMENT_PARSER_ARGS = originalParserArgs;
    if (originalParserProfile === undefined) delete process.env.R3MES_DOCUMENT_PARSER_PROFILE;
    else process.env.R3MES_DOCUMENT_PARSER_PROFILE = originalParserProfile;
  });

  it("lists stable built-in parser adapters", () => {
    expect(listKnowledgeParserAdapters()).toEqual([
      {
        id: "plain-text-v1",
        version: 1,
        sourceType: "TEXT",
        extensions: [".txt"],
      },
      {
        id: "markdown-v1",
        version: 1,
        sourceType: "MARKDOWN",
        extensions: [".md"],
      },
      {
        id: "json-normalized-v1",
        version: 1,
        sourceType: "JSON",
        extensions: [".json"],
      },
    ]);
  });

  it("keeps existing extension support behavior", () => {
    delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    delete process.env.R3MES_DOCUMENT_PARSER_ARGS;

    expect(isSupportedKnowledgeFilename("note.txt")).toBe(true);
    expect(isSupportedKnowledgeFilename("note.md")).toBe(true);
    expect(isSupportedKnowledgeFilename("note.json")).toBe(true);
    expect(isSupportedKnowledgeFilename("note.pdf")).toBe(false);
    expect(getKnowledgeParserForFilename("note.pdf")).toBeNull();
  });

  it("enables pdf/docx only when an external document parser is configured", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log('# Parsed document\\nSource bytes: '+require('fs').statSync(process.argv[1]).size)\" {input}";

    expect(isSupportedKnowledgeFilename("report.pdf")).toBe(true);
    expect(isSupportedKnowledgeFilename("report.docx")).toBe(true);
    expect(getKnowledgeParserForFilename("report.pdf")?.id).toBe("external-document-parser-v1");
    expect(listKnowledgeParserAdapters().some((parser) => parser.extensions.includes(".pdf"))).toBe(true);
  });

  it("reports parser capabilities without exposing command details", () => {
    delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    const withoutExternal = listKnowledgeParserCapabilities();

    expect(withoutExternal.some((parser) => parser.id === "plain-text-v1" && parser.available)).toBe(true);
    expect(withoutExternal.find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      available: false,
      extensions: [".pdf", ".docx"],
      kind: "external",
    });

    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    const withExternal = listKnowledgeParserCapabilities();

    expect(withExternal.find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      available: true,
      reason: null,
    });
  });

  it("reports the configured external parser profile without making it a hard dependency", () => {
    process.env.R3MES_DOCUMENT_PARSER_PROFILE = "docling";
    delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;

    expect(listKnowledgeParserCapabilities().find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      available: false,
      profile: "docling",
      reason: expect.stringContaining("docling"),
    });

    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    expect(listKnowledgeParserCapabilities().find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      available: true,
      profile: "docling",
      reason: null,
    });
  });

  it("falls back to the generic external parser profile for unknown profile values", () => {
    process.env.R3MES_DOCUMENT_PARSER_PROFILE = "custom-lab-parser";

    expect(listKnowledgeParserCapabilities().find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      profile: "external",
    });
  });

  it("keeps Windows paths intact in external parser args", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(process.argv[1])\" \"C:\\Users\\r3mes\\sample parser\\bridge.py\"";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.text).toBe("C:\\Users\\r3mes\\sample parser\\bridge.py");
  });

  it("parses configured pdf/docx files through the external command", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log('# Parsed document\\nSource bytes: '+require('fs').statSync(process.argv[1]).size)\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.sourceType).toBe("PDF");
    expect(parsed.parser).toEqual({ id: "external-document-parser-v1", version: 1 });
    expect(parsed.text).toContain("# Parsed document");
    expect(parsed.artifacts.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.originalBytes).toBeGreaterThan(0);
  });

  it("parses text and includes parser diagnostics", () => {
    const parsed = parseKnowledgeBuffer("note.txt", Buffer.from("Merhaba bilgi notu", "utf8"));

    expect(parsed.sourceType).toBe("TEXT");
    expect(parsed.text).toBe("Merhaba bilgi notu");
    expect(parsed.artifacts[0]).toMatchObject({ kind: "paragraph" });
    expect(parsed.parser).toEqual({ id: "plain-text-v1", version: 1 });
    expect(parsed.diagnostics.originalBytes).toBeGreaterThan(0);
    expect(parsed.diagnostics.normalizedChars).toBe(parsed.text.length);
  });

  it("normalizes json through the json adapter", () => {
    const parsed = parseKnowledgeBuffer("data.json", Buffer.from('{"b":2,"a":1}', "utf8"));

    expect(parsed.sourceType).toBe("JSON");
    expect(parsed.parser.id).toBe("json-normalized-v1");
    expect(parsed.text).toContain('"b": 2');
    expect(parsed.text).toContain('"a": 1');
  });

  it("normalizes parser text without destroying markdown tables and lists", () => {
    const normalized = normalizeParsedKnowledgeText(
      [
        "# Klinik Not",
        "",
        "Hasta kasık ağrısı",
        "ve akıntı tarif ediyor",
        "",
        "| Bulgu | Yorum |",
        "| --- | --- |",
        "| Ateş | hızlı değerlendirme |",
        "",
        "- Şiddetli ağrı varsa başvur.",
        "- Kanama varsa bekleme.",
      ].join("\r\n"),
      "MARKDOWN",
    );

    expect(normalized).toContain("Hasta kasık ağrısı ve akıntı tarif ediyor");
    expect(normalized).toContain("| Bulgu | Yorum |");
    expect(normalized).toContain("| Ateş | hızlı değerlendirme |");
    expect(normalized).toContain("- Şiddetli ağrı varsa başvur.");
  });

  it("keeps JSON parser output byte-for-byte except trimming", () => {
    const text = '{\n  "a": 1\n}';

    expect(normalizeParsedKnowledgeText(`\n${text}\n`, "JSON")).toBe(text);
  });

  it("splits long markdown tables while repeating the table header", () => {
    const table = [
      "| Bulgu | Yorum |",
      "| --- | --- |",
      "| Ateş | hızlı değerlendirme gerekir |",
      "| Kanama | beklemeden değerlendirilmelidir |",
      "| Ağrı | süre ve şiddet takip edilmelidir |",
      "| Akıntı | koku ve kaşıntı ile birlikte değerlendirilir |",
    ].join("\n");

    const chunks = chunkKnowledgeText(table, 130);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain("| Bulgu | Yorum |");
      expect(chunk.content).toContain("| --- | --- |");
    }
  });

  it("preserves heading context when splitting embedded markdown tables", () => {
    const table = [
      "# KAP Kar Dağıtım Tablosu",
      "Bildirim: EREGL 1578858",
      "| Satır | Tutar |",
      "| --- | --- |",
      "| Net dönem kârı | 511.801.109 |",
      "| Olağanüstü yedekler | 3.850.000.000 |",
      "| Dağıtılması öngörülen diğer kaynaklar | 3.352.908.083 |",
      "| Bağışlar eklenmiş net dağıtılabilir dönem kârı | 579.151.463 |",
    ].join("\n");

    const chunks = chunkKnowledgeText(table, 160);
    const tableChunks = chunks.filter((chunk) => chunk.content.includes("| Satır | Tutar |"));

    expect(tableChunks.length).toBeGreaterThan(1);
    for (const chunk of tableChunks) {
      expect(chunk.content).toContain("Bildirim: EREGL 1578858");
      expect(chunk.content).toContain("| Satır | Tutar |");
      expect(chunk.content).toContain("| --- | --- |");
    }
  });

  it("creates artifact-aware chunks without injecting route metadata into content", () => {
    const parsed = parseKnowledgeBuffer(
      "lesson.md",
      Buffer.from(
        [
          "# Hafta 5",
          "",
          "## Büyük Verinin 5V Özellikleri",
          "",
          "- Volume",
          "- Velocity",
          "- Variety",
          "- Veracity",
          "- Value",
        ].join("\n"),
        "utf8",
      ),
    );

    const chunks = chunkParsedKnowledgeDocument(parsed, 400);

    expect(chunks.some((chunk) => chunk.artifactKind === "list" || chunk.content.includes("Volume"))).toBe(true);
    expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("Source Summary:");
    expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("Tags:");
  });
});
