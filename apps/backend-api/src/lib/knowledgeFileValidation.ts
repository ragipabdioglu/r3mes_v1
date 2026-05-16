import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type KnowledgeSourceType = "pdf" | "docx" | "pptx" | "json" | "text" | "markdown" | "html" | "csv" | "xlsx";
export type KnowledgeScanStatus = "CLEAN" | "QUARANTINED" | "FAILED";
export type KnowledgeScanProvider = "local_stub" | "command" | "env_override";
export type KnowledgeScanProviderStatus = "ok" | "warning" | "error";

export type KnowledgeFileValidationInput = {
  filename: string;
  bytes: Buffer | Uint8Array;
  declaredMime?: string;
};

export type KnowledgeFileValidationResult = {
  ok: true;
  sourceExtension: string;
  declaredMime?: string;
  detectedMime: string;
  detectedSourceType: KnowledgeSourceType;
} | {
  ok: false;
  reject: {
    error: string;
    message: string;
  };
};

export type KnowledgeMalwareScanInput = {
  filename?: string;
  contentHash?: string;
  storagePath?: string;
  bytes?: Buffer | Uint8Array;
};

export type KnowledgeMalwareScanResult = {
  status: KnowledgeScanStatus;
  reason?: string;
  diagnostics: {
    provider: KnowledgeScanProvider;
    status: KnowledgeScanProviderStatus;
    durationMs: number;
    reason?: string;
    scannerVersion?: string;
    signature?: string;
  };
};

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const UTF8_REPLACEMENT = "\uFFFD";
const LOCAL_STUB_SCANNER_VERSION = "local_stub:eicar-only:v1";
const execFileAsync = promisify(execFile);

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".json", ".txt", ".md", ".html", ".htm", ".csv"]);

function isXlsxIntakeEnabled(): boolean {
  return process.env.R3MES_ENABLE_XLSX_INTAKE === "1";
}

function normalizeExtension(filename: string): string {
  return path.extname(filename || "").toLowerCase();
}

function startsWith(bytes: Buffer, expected: string): boolean {
  return bytes.subarray(0, expected.length).equals(Buffer.from(expected, "ascii"));
}

function isZip(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  return (
    bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  );
}

function hasBinaryControlBytes(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true;
    if (byte < 0x09) return true;
    if (byte > 0x0d && byte < 0x20) return true;
  }
  return false;
}

function isUtf8TextLike(bytes: Buffer): boolean {
  if (bytes.length === 0) return true;
  if (hasBinaryControlBytes(bytes)) return false;
  const decoded = bytes.toString("utf8");
  return !decoded.includes(UTF8_REPLACEMENT);
}

function looksLikeJson(bytes: Buffer): boolean {
  const text = bytes.toString("utf8").trim();
  if (!text) return false;
  if (text.includes(UTF8_REPLACEMENT)) return false;
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return text.endsWith("}") || text.endsWith("]");
  }
}

function detectedMimeFor(extension: string): string {
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".md":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

function sourceTypeFor(extension: string): KnowledgeSourceType {
  switch (extension) {
    case ".pdf":
      return "pdf";
    case ".docx":
      return "docx";
    case ".pptx":
      return "pptx";
    case ".xlsx":
      return "xlsx";
    case ".json":
      return "json";
    case ".csv":
      return "csv";
    case ".html":
    case ".htm":
      return "html";
    case ".md":
      return "markdown";
    default:
      return "text";
  }
}

export function validateKnowledgeFile(input: KnowledgeFileValidationInput): KnowledgeFileValidationResult {
  const sourceExtension = normalizeExtension(input.filename);
  const bytes = Buffer.from(input.bytes);

  if (!SUPPORTED_EXTENSIONS.has(sourceExtension) && !(sourceExtension === ".xlsx" && isXlsxIntakeEnabled())) {
    return {
      ok: false,
      reject: {
        error: "UNSUPPORTED_KNOWLEDGE_FILE_EXTENSION",
        message: "Knowledge upload format is not supported.",
      },
    };
  }

  if (sourceExtension === ".pdf" && !startsWith(bytes, "%PDF")) {
    return {
      ok: false,
      reject: {
        error: "KNOWLEDGE_FILE_MAGIC_MISMATCH",
        message: "PDF upload must start with a valid %PDF signature.",
      },
    };
  }

  if ((sourceExtension === ".docx" || sourceExtension === ".pptx" || sourceExtension === ".xlsx") && !isZip(bytes)) {
    return {
      ok: false,
      reject: {
        error: "KNOWLEDGE_FILE_MAGIC_MISMATCH",
        message: "Office document upload must start with a ZIP signature.",
      },
    };
  }

  if (sourceExtension === ".json" && !looksLikeJson(bytes)) {
    return {
      ok: false,
      reject: {
        error: "INVALID_KNOWLEDGE_JSON",
        message: "JSON upload must be parseable or look like a complete JSON object or array.",
      },
    };
  }

  if ([".txt", ".md", ".html", ".htm", ".csv"].includes(sourceExtension) && !isUtf8TextLike(bytes)) {
    return {
      ok: false,
      reject: {
        error: "INVALID_KNOWLEDGE_TEXT",
        message: "Text knowledge upload must be UTF-8 text-like content.",
      },
    };
  }

  return {
    ok: true,
    sourceExtension,
    declaredMime: input.declaredMime,
    detectedMime: detectedMimeFor(sourceExtension),
    detectedSourceType: sourceTypeFor(sourceExtension),
  };
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function isStrictScanMode(): boolean {
  const raw = process.env.R3MES_KNOWLEDGE_SCAN_MODE?.trim().toLowerCase();
  return raw === "strict" || process.env.R3MES_KNOWLEDGE_SCAN_STRICT === "1" || process.env.NODE_ENV === "production";
}

function selectedScanProvider(): KnowledgeScanProvider {
  const raw = process.env.R3MES_KNOWLEDGE_SCAN_PROVIDER?.trim().toLowerCase();
  if (raw === "command") return "command";
  return "local_stub";
}

async function scanWithCommand(input: KnowledgeMalwareScanInput, startedAt: bigint): Promise<KnowledgeMalwareScanResult> {
  const configured = process.env.R3MES_KNOWLEDGE_SCAN_COMMAND?.trim();
  if (!configured) {
    return {
      status: "FAILED",
      reason: "R3MES_KNOWLEDGE_SCAN_PROVIDER=command requires R3MES_KNOWLEDGE_SCAN_COMMAND.",
      diagnostics: {
        provider: "command",
        status: "error",
        durationMs: elapsedMs(startedAt),
        reason: "Missing scanner command.",
      },
    };
  }

  const [command, ...baseArgs] = configured.split(/\s+/).filter(Boolean);
  const args = [...baseArgs];
  if (input.storagePath) args.push(input.storagePath);

  try {
    const result = await execFileAsync(command, args, {
      timeout: Number(process.env.R3MES_KNOWLEDGE_SCAN_TIMEOUT_MS || 30_000),
      maxBuffer: 1024 * 1024,
    });
    return {
      status: "CLEAN",
      diagnostics: {
        provider: "command",
        status: "ok",
        durationMs: elapsedMs(startedAt),
        reason: result.stdout.trim() || undefined,
        scannerVersion: process.env.R3MES_KNOWLEDGE_SCAN_COMMAND_VERSION?.trim() || undefined,
      },
    };
  } catch (error) {
    const exitCode = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
    const stderr = typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: unknown }).stderr || "").trim() : "";
    const stdout = typeof error === "object" && error && "stdout" in error ? String((error as { stdout?: unknown }).stdout || "").trim() : "";
    const reason = stderr || stdout || (error instanceof Error ? error.message : "Scanner command failed.");

    if (exitCode === 1) {
      return {
        status: "QUARANTINED",
        reason,
        diagnostics: {
          provider: "command",
          status: "ok",
          durationMs: elapsedMs(startedAt),
          reason,
          scannerVersion: process.env.R3MES_KNOWLEDGE_SCAN_COMMAND_VERSION?.trim() || undefined,
        },
      };
    }

    return {
      status: "FAILED",
      reason,
      diagnostics: {
        provider: "command",
        status: "error",
        durationMs: elapsedMs(startedAt),
        reason,
        scannerVersion: process.env.R3MES_KNOWLEDGE_SCAN_COMMAND_VERSION?.trim() || undefined,
      },
    };
  }
}

export async function scanKnowledgeUpload(input: KnowledgeMalwareScanInput): Promise<KnowledgeMalwareScanResult> {
  const startedAt = process.hrtime.bigint();
  const forced = process.env.R3MES_KNOWLEDGE_SCAN_RESULT?.trim().toUpperCase();
  if (forced === "QUARANTINED" || forced === "FAILED" || forced === "CLEAN") {
    return {
      status: forced,
      reason: forced === "CLEAN" ? undefined : "Configured by R3MES_KNOWLEDGE_SCAN_RESULT.",
      diagnostics: {
        provider: "env_override",
        status: forced === "FAILED" ? "error" : "ok",
        durationMs: elapsedMs(startedAt),
        reason: "Configured by R3MES_KNOWLEDGE_SCAN_RESULT.",
      },
    };
  }

  const provider = selectedScanProvider();
  if (provider === "command") return scanWithCommand(input, startedAt);

  if (isStrictScanMode() && process.env.R3MES_KNOWLEDGE_SCAN_ALLOW_LOCAL_STUB !== "1") {
    return {
      status: "FAILED",
      reason: "Local stub malware scanner is not allowed in production or strict scan mode.",
      diagnostics: {
        provider: "local_stub",
        status: "error",
        durationMs: elapsedMs(startedAt),
        reason: "Configure R3MES_KNOWLEDGE_SCAN_PROVIDER=command or set R3MES_KNOWLEDGE_SCAN_ALLOW_LOCAL_STUB=1 explicitly.",
        scannerVersion: LOCAL_STUB_SCANNER_VERSION,
      },
    };
  }

  const text = input.bytes ? Buffer.from(input.bytes).toString("latin1") : "";
  if (text.includes(EICAR_SIGNATURE)) {
    return {
      status: "QUARANTINED",
      reason: "EICAR test signature detected.",
      diagnostics: {
        provider: "local_stub",
        status: "warning",
        durationMs: elapsedMs(startedAt),
        reason: "Deterministic local stub detected the EICAR test signature.",
        scannerVersion: LOCAL_STUB_SCANNER_VERSION,
        signature: "EICAR",
      },
    };
  }

  return {
    status: "CLEAN",
    diagnostics: {
      provider: "local_stub",
      status: "warning",
      durationMs: elapsedMs(startedAt),
      reason: "Deterministic local stub only checks the EICAR test signature.",
      scannerVersion: LOCAL_STUB_SCANNER_VERSION,
    },
  };
}
