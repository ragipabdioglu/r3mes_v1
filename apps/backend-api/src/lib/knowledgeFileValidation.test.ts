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
  });

  it("allows scanner status override from env", async () => {
    vi.stubEnv("R3MES_KNOWLEDGE_SCAN_RESULT", "FAILED");

    const result = await scanKnowledgeUpload({
      filename: "clean.txt",
      bytes: Buffer.from("clean text"),
    });

    expect(result.status).toBe("FAILED");
  });
});
