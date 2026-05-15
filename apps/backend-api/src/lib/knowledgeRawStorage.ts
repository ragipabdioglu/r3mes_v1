import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  type KnowledgeMalwareScanResult,
  type KnowledgeSourceType,
  scanKnowledgeUpload,
  validateKnowledgeFile,
} from "./knowledgeFileValidation.js";

export type KnowledgeRawStorageInput = {
  filename: string;
  stream: AsyncIterable<Buffer | Uint8Array> | Readable;
  declaredMime?: string;
  maxBytes?: number;
};

export type KnowledgeRawStorageResult = {
  storagePath: string;
  contentHash: string;
  byteSize: number;
  sourceExtension: string;
  declaredMime?: string;
  detectedMime: string;
  detectedSourceType: KnowledgeSourceType;
  sanitizedFilename: string;
  scan: KnowledgeMalwareScanResult;
  quarantined: boolean;
};

export class KnowledgeRawStorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeRawStorageError";
    this.code = code;
  }
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const VALIDATION_SAMPLE_BYTES = 1024 * 1024;

function repoLocalStorageDir(): string {
  return path.resolve(process.cwd(), "data", "knowledge-raw");
}

export function getKnowledgeStorageDir(): string {
  const configured = process.env.R3MES_KNOWLEDGE_STORAGE_DIR?.trim();
  return path.resolve(configured || repoLocalStorageDir());
}

export function sanitizeKnowledgeFilename(filename: string): string {
  const basename = path.basename(filename || "upload");
  const normalized = basename.normalize("NFKD").replace(/[^\w.-]+/g, "_");
  const trimmed = normalized.replace(/_{2,}/g, "_").replace(/^\.+/, "").slice(0, 160);
  return trimmed || "upload";
}

function safeStorageName(contentHash: string, sanitizedFilename: string): string {
  return `${contentHash.slice(0, 24)}-${sanitizedFilename}`;
}

async function writeChunk(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function closeWriteStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function destroyWriteStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve) => {
    if (stream.destroyed) {
      resolve();
      return;
    }
    stream.destroy();
    stream.once("close", resolve);
  });
}

export async function storeKnowledgeRawUpload(input: KnowledgeRawStorageInput): Promise<KnowledgeRawStorageResult> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const sanitizedFilename = sanitizeKnowledgeFilename(input.filename);
  const storageRoot = getKnowledgeStorageDir();
  const tmpDir = path.join(storageRoot, "tmp");
  const rawDir = path.join(storageRoot, "raw");
  const quarantineDir = path.join(storageRoot, "quarantine");
  const tmpPath = path.join(tmpDir, `${crypto.randomUUID()}.upload`);
  const hash = crypto.createHash("sha256");
  const validationChunks: Buffer[] = [];
  let validationBytes = 0;
  let byteSize = 0;
  let streamClosed = false;

  await mkdir(tmpDir, { recursive: true });
  await mkdir(rawDir, { recursive: true });
  await mkdir(quarantineDir, { recursive: true });

  const writer = fs.createWriteStream(tmpPath, { flags: "wx" });

  try {
    for await (const rawChunk of input.stream) {
      const chunk = Buffer.from(rawChunk);
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        throw new KnowledgeRawStorageError("KNOWLEDGE_UPLOAD_TOO_LARGE", "Knowledge upload exceeds the configured size limit.");
      }
      hash.update(chunk);
      if (validationBytes < VALIDATION_SAMPLE_BYTES) {
        const remaining = VALIDATION_SAMPLE_BYTES - validationBytes;
        const sampleChunk = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        validationChunks.push(sampleChunk);
        validationBytes += sampleChunk.length;
      }
      await writeChunk(writer, chunk);
    }

    await closeWriteStream(writer);
    streamClosed = true;

    const validationSample = Buffer.concat(validationChunks, validationBytes);
    const validation = validateKnowledgeFile({
      filename: sanitizedFilename,
      bytes: validationSample,
      declaredMime: input.declaredMime,
    });
    if (!validation.ok) {
      throw new KnowledgeRawStorageError(validation.reject.error, validation.reject.message);
    }

    const contentHash = hash.digest("hex");
    const finalPath = path.join(rawDir, safeStorageName(contentHash, sanitizedFilename));
    await rename(tmpPath, finalPath);

    const scan = await scanKnowledgeUpload({
      filename: sanitizedFilename,
      contentHash,
      storagePath: finalPath,
      bytes: validationSample,
    });

    if (scan.status === "FAILED") {
      throw new KnowledgeRawStorageError("KNOWLEDGE_MALWARE_SCAN_FAILED", scan.reason || "Knowledge upload malware scan failed.");
    }

    if (scan.status === "QUARANTINED") {
      const quarantinePath = path.join(quarantineDir, safeStorageName(contentHash, sanitizedFilename));
      await rename(finalPath, quarantinePath);
      return {
        storagePath: quarantinePath,
        contentHash,
        byteSize,
        sourceExtension: validation.sourceExtension,
        declaredMime: validation.declaredMime,
        detectedMime: validation.detectedMime,
        detectedSourceType: validation.detectedSourceType,
        sanitizedFilename,
        scan,
        quarantined: true,
      };
    }

    return {
      storagePath: finalPath,
      contentHash,
      byteSize,
      sourceExtension: validation.sourceExtension,
      declaredMime: validation.declaredMime,
      detectedMime: validation.detectedMime,
      detectedSourceType: validation.detectedSourceType,
      sanitizedFilename,
      scan,
      quarantined: false,
    };
  } catch (error) {
    if (!streamClosed) await destroyWriteStream(writer);
    await rm(tmpPath, { force: true });
    if (error instanceof KnowledgeRawStorageError) throw error;
    throw new KnowledgeRawStorageError("KNOWLEDGE_RAW_STORAGE_FAILED", error instanceof Error ? error.message : "Raw storage failed.");
  }
}
