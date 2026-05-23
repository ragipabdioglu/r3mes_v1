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
  const originalParserHealthcheck = process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK;
  const originalParserHealthcheckTimeout = process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK_TIMEOUT_MS;

  afterEach(() => {
    if (originalParserCommand === undefined) delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    else process.env.R3MES_DOCUMENT_PARSER_COMMAND = originalParserCommand;
    if (originalParserArgs === undefined) delete process.env.R3MES_DOCUMENT_PARSER_ARGS;
    else process.env.R3MES_DOCUMENT_PARSER_ARGS = originalParserArgs;
    if (originalParserProfile === undefined) delete process.env.R3MES_DOCUMENT_PARSER_PROFILE;
    else process.env.R3MES_DOCUMENT_PARSER_PROFILE = originalParserProfile;
    if (originalParserHealthcheck === undefined) delete process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK;
    else process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK = originalParserHealthcheck;
    if (originalParserHealthcheckTimeout === undefined) delete process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK_TIMEOUT_MS;
    else process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK_TIMEOUT_MS = originalParserHealthcheckTimeout;
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
      {
        id: "csv-spreadsheet-v1",
        version: 1,
        sourceType: "TEXT",
        extensions: [".csv"],
      },
    ]);
  });

  it("keeps existing extension support behavior", () => {
    delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    delete process.env.R3MES_DOCUMENT_PARSER_ARGS;

    expect(isSupportedKnowledgeFilename("note.txt")).toBe(true);
    expect(isSupportedKnowledgeFilename("note.md")).toBe(true);
    expect(isSupportedKnowledgeFilename("note.json")).toBe(true);
    expect(isSupportedKnowledgeFilename("sheet.csv")).toBe(true);
    expect(isSupportedKnowledgeFilename("sheet.xlsx")).toBe(false);
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
      sourceType: "PDF",
      sourceTypes: ["PDF", "DOCX", "PPTX", "HTML"],
      extensions: [".pdf", ".docx", ".pptx", ".html", ".htm"],
      mimeTypes: expect.arrayContaining(["application/pdf", "text/html"]),
      kind: "external",
      health: "unavailable",
      priority: 50,
      supportsTables: true,
      supportsOcr: false,
      supportsSpreadsheets: false,
      outputSchemaVersion: 1,
    });
    expect(withoutExternal.find((parser) => parser.id === "external-document-parser-v1")?.reason).not.toContain(process.execPath);

    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    const withExternal = listKnowledgeParserCapabilities();

    expect(withExternal.find((parser) => parser.id === "external-document-parser-v1")).toMatchObject({
      available: true,
      health: "ready",
      smokeStatus: "not_run",
      reason: null,
      supportsTables: true,
      supportsSpreadsheets: false,
      outputSchemaVersion: 1,
    });
  });

  it("reports external parser smoke health without exposing command or path details", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',outputSchemaVersion:2,text:'Smoke parsed',structuredArtifacts:[]}))\" {input}";
    process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK = "1";

    const capability = listKnowledgeParserCapabilities().find((parser) => parser.id === "external-document-parser-v1");

    expect(capability).toMatchObject({
      available: true,
      health: "ready",
      smokeStatus: "passed",
      outputSchemaVersion: 2,
      reason: null,
    });
    expect(capability?.smokeDurationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(capability)).not.toContain(process.execPath);
  });

  it("marks external parser capability degraded when smoke fails", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"process.exit(7)\" {input}";
    process.env.R3MES_DOCUMENT_PARSER_HEALTHCHECK = "1";

    const capability = listKnowledgeParserCapabilities().find((parser) => parser.id === "external-document-parser-v1");

    expect(capability).toMatchObject({
      available: true,
      health: "degraded",
      smokeStatus: "failed",
      outputSchemaVersion: 1,
      reason: "External parser smoke failed with exit code 7",
    });
    expect(JSON.stringify(capability)).not.toContain(process.execPath);
  });

  it("reports enriched built-in parser capabilities", () => {
    const capabilities = listKnowledgeParserCapabilities();

    expect(capabilities.find((parser) => parser.id === "plain-text-v1")).toMatchObject({
      sourceType: "TEXT",
      sourceTypes: ["TEXT"],
      mimeTypes: ["text/plain"],
      priority: 60,
      supportsTables: false,
      supportsOcr: false,
      supportsSpreadsheets: false,
      outputSchemaVersion: 1,
    });
    expect(capabilities.find((parser) => parser.id === "markdown-v1")).toMatchObject({
      sourceTypes: ["MARKDOWN"],
      mimeTypes: ["text/markdown", "text/x-markdown"],
      priority: 70,
      supportsTables: true,
      supportsOcr: false,
      supportsSpreadsheets: false,
      outputSchemaVersion: 1,
    });
    expect(capabilities.find((parser) => parser.id === "json-normalized-v1")).toMatchObject({
      sourceTypes: ["JSON"],
      mimeTypes: ["application/json"],
      priority: 80,
      supportsTables: false,
      supportsOcr: false,
      supportsSpreadsheets: false,
      outputSchemaVersion: 1,
    });
    expect(capabilities.find((parser) => parser.id === "csv-spreadsheet-v1")).toMatchObject({
      sourceTypes: ["TEXT"],
      mimeTypes: expect.arrayContaining(["text/csv"]),
      priority: 85,
      supportsTables: true,
      supportsOcr: false,
      supportsSpreadsheets: true,
      outputSchemaVersion: 1,
    });
    expect(capabilities.find((parser) => parser.id === "xlsx-spreadsheet-parser-v1")).toMatchObject({
      available: false,
      sourceTypes: ["TEXT"],
      extensions: [".xlsx"],
      health: "unavailable",
      supportsTables: true,
      supportsSpreadsheets: true,
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
      supportsOcr: true,
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
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.parserRun).toMatchObject({
      id: "external-document-parser-v1",
      version: 1,
      profile: "external",
      fallbackUsed: false,
      outputSchemaVersion: 1,
    });
    expect(parsed.text).toContain("# Parsed document");
    expect(parsed.artifacts.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.originalBytes).toBeGreaterThan(0);
  });

  it("preserves external parser structured artifacts for downstream document understanding", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',text:'Metric | Value\\\\nRevenue | 123',artifacts:[{id:'external-table-1',kind:'table',text:'Metric | Value\\\\nRevenue | 123',page:2,title:'Financials'}],structuredArtifacts:[{version:1,kind:'table',tableId:'external-table-1',title:'Financials',page:2,headers:[{columnId:'metric',text:'Metric',normalizedText:'metric'},{columnId:'value',text:'Value',normalizedText:'value'}],rows:[{rowId:'r1',label:'Revenue',cells:[{columnId:'metric',text:'Revenue',normalizedText:'Revenue',value:'Revenue',valueType:'string'},{columnId:'value',text:'123',normalizedText:'123',value:123,valueType:'number'}]}],provenance:{parserId:'docling-test',parserVersion:1,artifactId:'external-table-1'}}]}))\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.structuredArtifacts).toHaveLength(1);
    expect(parsed.structuredArtifacts?.[0]).toMatchObject({
      kind: "table",
      tableId: "external-table-1",
      page: 2,
      provenance: {
        parserId: "docling-test",
        parserVersion: 1,
        artifactId: "external-table-1",
      },
    });
    expect(parsed.diagnostics.warnings).not.toContain("external_parser_invalid_structured_artifacts");
  });

  it("surfaces invalid external structured artifact diagnostics without dropping valid artifacts", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',outputSchemaVersion:2,text:'Metric | Value\\\\nRevenue | 123',structuredArtifacts:[{version:1,kind:'table',tableId:'external-table-1',headers:[{columnId:'metric',text:'Metric'},{columnId:'value',text:'Value'}],rows:[{rowId:'r1',cells:[{columnId:'metric',text:'Revenue'},{columnId:'value',text:'123',value:123,valueType:'number'}]}],provenance:{parserId:'docling-test',parserVersion:1}},{kind:'table',tableId:'broken-table'}]}))\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.parserRun).toMatchObject({
      fallbackUsed: false,
      outputSchemaVersion: 2,
    });
    expect(parsed.structuredArtifacts).toHaveLength(1);
    expect(parsed.diagnostics.warnings).toContain("external_parser_invalid_structured_artifacts:1_of_2_rejected");
    expect(parsed.diagnostics.warnings).not.toContain("external_parser_structured_artifact_fallback");
  });

  it("marks structured artifact fallback when external parser structuredArtifacts is not usable", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',schemaVersion:2,text:'Plain text survives',structuredArtifacts:{kind:'table'}}))\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.parserRun).toMatchObject({
      fallbackUsed: true,
      outputSchemaVersion: 2,
    });
    expect(parsed.structuredArtifacts).toHaveLength(0);
    expect(parsed.diagnostics.warnings).toContain("external_parser_structured_artifacts_not_array");
    expect(parsed.diagnostics.warnings).toContain("external_parser_structured_artifact_fallback");
  });

  it("keeps external parser artifact ids stable and passes artifact metadata into chunks", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',text:'Revenue table\\nNet income 42',artifacts:[{kind:'table',text:'Revenue table\\nNet income 42',page:3,title:'Financials',metadata:{bbox:[1,2,3,4],parserBlockId:'b-7'}}]}))\" {input}";

    const first = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));
    const second = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));
    const chunks = chunkParsedKnowledgeDocument(first, 400);

    expect(first.artifacts[0]?.id).toBe(second.artifacts[0]?.id);
    expect(first.artifacts[0]?.id).toMatch(/^artifact-[a-f0-9]{16}$/u);
    expect(chunks[0]).toMatchObject({
      artifactId: first.artifacts[0]?.id,
      artifactKind: "table",
      artifactMetadata: { bbox: [1, 2, 3, 4], parserBlockId: "b-7" },
      artifactSplitIndex: 0,
      pageNumber: 3,
      sectionTitle: "Financials",
    });
  });

  it("keeps external parser markdown fallback for invalid JSON", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log('{not valid json')\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.sourceType).toBe("PDF");
    expect(parsed.text).toBe("{not valid json");
    expect(parsed.diagnostics.warnings).toEqual([]);
  });

  it("warns when external parser JSON output omits text and markdown", () => {
    process.env.R3MES_DOCUMENT_PARSER_COMMAND = process.execPath;
    process.env.R3MES_DOCUMENT_PARSER_ARGS = "-e \"console.log(JSON.stringify({sourceType:'PDF',artifacts:[{kind:'table',text:'A table'}]}))\" {input}";

    const parsed = parseKnowledgeBuffer("report.pdf", Buffer.from("%PDF fake bytes", "utf8"));

    expect(parsed.sourceType).toBe("PDF");
    expect(parsed.text).toContain("\"artifacts\"");
    expect(parsed.diagnostics.warnings).toContain("external_parser_json_missing_text");
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

  it("parses CSV into text and structured table artifacts", () => {
    const parsed = parseKnowledgeBuffer(
      "revenue.csv",
      Buffer.from([
        "Date;Account;Amount;Approved",
        "2026-05-01;Sales;1.234,56;true",
        "2026-05-02;Services;2500;false",
      ].join("\n"), "utf8"),
    );

    expect(parsed.sourceType).toBe("TEXT");
    expect(parsed.parser).toEqual({ id: "csv-spreadsheet-v1", version: 1 });
    expect(parsed.text).toContain("| Date | Account | Amount | Approved |");
    expect(parsed.artifacts[0]).toMatchObject({
      kind: "table",
      metadata: {
        delimiter: ";",
        sourceFormat: "csv",
      },
    });
    const table = parsed.structuredArtifacts?.[0];
    expect(table).toMatchObject({
      kind: "table",
      sheetName: "CSV",
      headers: [
        expect.objectContaining({ text: "Date", sourceCell: "A1" }),
        expect.objectContaining({ text: "Account", sourceCell: "B1" }),
        expect.objectContaining({ text: "Amount", sourceCell: "C1" }),
        expect.objectContaining({ text: "Approved", sourceCell: "D1" }),
      ],
    });
    if (table?.kind !== "table") throw new Error("Expected CSV structured table");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.cells.find((cell) => cell.columnId === "c1")).toMatchObject({ value: "2026-05-01", valueType: "date" });
    expect(table.rows[0]?.cells.find((cell) => cell.columnId === "c3")).toMatchObject({ value: 1234.56, valueType: "number" });
    expect(table.rows[0]?.cells.find((cell) => cell.columnId === "c4")).toMatchObject({ value: true, valueType: "boolean" });
  });

  it("keeps XLSX advertised as unavailable until a real parser is configured", () => {
    expect(getKnowledgeParserForFilename("workbook.xlsx")).toBeNull();
    expect(() => parseKnowledgeBuffer("workbook.xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toThrow("Desteklenmeyen bilgi dosyası");
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
