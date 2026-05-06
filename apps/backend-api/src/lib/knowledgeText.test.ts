import { afterEach, describe, expect, it } from "vitest";

import {
  getKnowledgeParserForFilename,
  isSupportedKnowledgeFilename,
  listKnowledgeParserAdapters,
  parseKnowledgeBuffer,
} from "./knowledgeText.js";

describe("knowledge parser adapters", () => {
  const originalParserCommand = process.env.R3MES_DOCUMENT_PARSER_COMMAND;
  const originalParserArgs = process.env.R3MES_DOCUMENT_PARSER_ARGS;

  afterEach(() => {
    if (originalParserCommand === undefined) delete process.env.R3MES_DOCUMENT_PARSER_COMMAND;
    else process.env.R3MES_DOCUMENT_PARSER_COMMAND = originalParserCommand;
    if (originalParserArgs === undefined) delete process.env.R3MES_DOCUMENT_PARSER_ARGS;
    else process.env.R3MES_DOCUMENT_PARSER_ARGS = originalParserArgs;
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

    expect(parsed.sourceType).toBe("MARKDOWN");
    expect(parsed.parser).toEqual({ id: "external-document-parser-v1", version: 1 });
    expect(parsed.text).toContain("# Parsed document");
    expect(parsed.diagnostics.originalBytes).toBeGreaterThan(0);
  });

  it("parses text and includes parser diagnostics", () => {
    const parsed = parseKnowledgeBuffer("note.txt", Buffer.from("Merhaba bilgi notu", "utf8"));

    expect(parsed.sourceType).toBe("TEXT");
    expect(parsed.text).toBe("Merhaba bilgi notu");
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
});
