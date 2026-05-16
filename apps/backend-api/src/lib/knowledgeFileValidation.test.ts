import { describe, expect, it, vi, afterEach } from "vitest";
import { scanKnowledgeUpload, validateKnowledgeFile } from "./knowledgeFileValidation.js";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("validateKnowledgeFile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects magic mismatch for a fake PDF", () => {
    const result = validateKnowledgeFile({
      filename: "guide.pdf",
      bytes: Buffer.from("not a pdf"),
      declaredMime: "application/pdf",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.error).toBe("KNOWLEDGE_FILE_MAGIC_MISMATCH");
  });

  it("accepts DOCX and PPTX as extension-specific source types over ZIP magic", () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    const docx = validateKnowledgeFile({ filename: "notes.docx", bytes: zipBytes });
    const pptx = validateKnowledgeFile({ filename: "deck.pptx", bytes: zipBytes });

    expect(docx.ok).toBe(true);
    expect(pptx.ok).toBe(true);
    if (docx.ok) expect(docx.detectedSourceType).toBe("docx");
    if (pptx.ok) expect(pptx.detectedSourceType).toBe("pptx");
  });

  it("accepts UTF-8 CSV as a spreadsheet pilot source type", () => {
    const result = validateKnowledgeFile({
      filename: "metrics.csv",
      bytes: Buffer.from("Date,Amount\n2026-05-01,42\n", "utf8"),
      declaredMime: "text/csv",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detectedMime).toBe("text/csv");
      expect(result.detectedSourceType).toBe("csv");
    }
  });

  it("keeps XLSX validation behind an explicit intake flag", () => {
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    expect(validateKnowledgeFile({ filename: "workbook.xlsx", bytes: zipBytes }).ok).toBe(false);

    vi.stubEnv("R3MES_ENABLE_XLSX_INTAKE", "1");
    const enabled = validateKnowledgeFile({ filename: "workbook.xlsx", bytes: zipBytes });

    expect(enabled.ok).toBe(true);
    if (enabled.ok) expect(enabled.detectedSourceType).toBe("xlsx");
  });

  it("rejects fake XLSX bytes even when intake validation is enabled", () => {
    vi.stubEnv("R3MES_ENABLE_XLSX_INTAKE", "1");

    const result = validateKnowledgeFile({
      filename: "workbook.xlsx",
      bytes: Buffer.from("not a zip"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.error).toBe("KNOWLEDGE_FILE_MAGIC_MISMATCH");
  });

  it("rejects JSON that is neither parseable nor JSON-looking", () => {
    const result = validateKnowledgeFile({
      filename: "facts.json",
      bytes: Buffer.from("plain text"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reject.error).toBe("INVALID_KNOWLEDGE_JSON");
  });

  it("detects EICAR with the deterministic local scanner stub", async () => {
    const result = await scanKnowledgeUpload({
      filename: "eicar.txt",
      bytes: Buffer.from(EICAR, "ascii"),
    });

    expect(result.status).toBe("QUARANTINED");
    expect(result.diagnostics).toMatchObject({
      provider: "local_stub",
      status: "warning",
      signature: "EICAR",
    });
    expect(result.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("allows scanner status override from env", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_RESULT", "FAILED");

    const result = await scanKnowledgeUpload({
      filename: "clean.txt",
      bytes: Buffer.from("clean text"),
    });

    expect(result.status).toBe("FAILED");
    expect(result.diagnostics.provider).toBe("env_override");
  });

  it("fails closed when strict mode would use the local stub", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_MODE", "strict");

    const result = await scanKnowledgeUpload({
      filename: "clean.txt",
      bytes: Buffer.from("clean text"),
    });

    expect(result.status).toBe("FAILED");
    expect(result.diagnostics).toMatchObject({
      provider: "local_stub",
      status: "error",
    });
  });

  it("allows explicit local stub opt-in under strict mode", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_MODE", "strict");
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_ALLOW_LOCAL_STUB", "1");

    const result = await scanKnowledgeUpload({
      filename: "clean.txt",
      bytes: Buffer.from("clean text"),
    });

    expect(result.status).toBe("CLEAN");
    expect(result.diagnostics.provider).toBe("local_stub");
  });

  it("fails closed when command provider has no command configured", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_PROVIDER", "command");

    const result = await scanKnowledgeUpload({
      filename: "clean.txt",
      bytes: Buffer.from("clean text"),
    });

    expect(result.status).toBe("FAILED");
    expect(result.diagnostics).toMatchObject({
      provider: "command",
      status: "error",
    });
  });
});
