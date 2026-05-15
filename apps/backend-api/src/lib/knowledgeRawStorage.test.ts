import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeRawStorageError,
  sanitizeKnowledgeFilename,
  storeKnowledgeRawUpload,
} from "./knowledgeRawStorage.js";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function streamFrom(content: Buffer | string): Readable {
  return Readable.from([typeof content === "string" ? Buffer.from(content) : content]);
}

describe("storeKnowledgeRawUpload", () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "r3mes-knowledge-raw-"));
    vi.stubEnv("R3MES_KNOWLEDGE_STORAGE_DIR", storageDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(storageDir, { recursive: true, force: true });
  });

  it("writes raw content with deterministic SHA-256 hash metadata", async () => {
    const content = Buffer.from("%PDF-1.7\nhello\n%%EOF", "utf8");

    const result = await storeKnowledgeRawUpload({
      filename: "report.pdf",
      stream: streamFrom(content),
      declaredMime: "application/pdf",
    });

    expect(result.contentHash).toBe(createHash("sha256").update(content).digest("hex"));
    expect(result.byteSize).toBe(content.length);
    expect(result.sourceExtension).toBe(".pdf");
    expect(result.detectedMime).toBe("application/pdf");
    expect(result.detectedSourceType).toBe("pdf");
    expect(result.declaredMime).toBe("application/pdf");
    expect(result.quarantined).toBe(false);
    await expect(readFile(result.storagePath)).resolves.toEqual(content);
  });

  it("sanitizes path traversal filenames before final storage", async () => {
    const result = await storeKnowledgeRawUpload({
      filename: "..\\..\\secret?.txt",
      stream: streamFrom("plain UTF-8 text"),
    });

    expect(result.sanitizedFilename).toBe("secret_.txt");
    expect(path.relative(storageDir, result.storagePath).startsWith("raw")).toBe(true);
    expect(path.basename(result.storagePath)).toContain("secret_.txt");
  });

  it("quarantines EICAR content with the deterministic scanner stub", async () => {
    const result = await storeKnowledgeRawUpload({
      filename: "eicar.txt",
      stream: streamFrom(EICAR),
    });

    expect(result.scan.status).toBe("QUARANTINED");
    expect(result.quarantined).toBe(true);
    expect(path.relative(storageDir, result.storagePath).startsWith("quarantine")).toBe(true);
    await expect(stat(result.storagePath)).resolves.toMatchObject({ size: EICAR.length });
  });

  it("rejects uploads over maxBytes and removes temporary content", async () => {
    await expect(
      storeKnowledgeRawUpload({
        filename: "large.txt",
        stream: streamFrom("too large"),
        maxBytes: 3,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_UPLOAD_TOO_LARGE",
    } satisfies Partial<KnowledgeRawStorageError>);

    await expect(stat(path.join(storageDir, "tmp"))).resolves.toBeTruthy();
  });
});

describe("sanitizeKnowledgeFilename", () => {
  it("keeps only a basename-safe filename", () => {
    expect(sanitizeKnowledgeFilename("../../nested/report final.pdf")).toBe("report_final.pdf");
  });
});
