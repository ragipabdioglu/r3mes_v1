import path from "node:path";

export type KnowledgeSourceType = "pdf" | "docx" | "pptx" | "json" | "text" | "markdown" | "html";
export type KnowledgeScanStatus = "CLEAN" | "QUARANTINED" | "FAILED";

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
};

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const UTF8_REPLACEMENT = "\uFFFD";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".json", ".txt", ".md", ".html", ".htm"]);

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
    case ".json":
      return "application/json";
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
    case ".json":
      return "json";
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

  if (!SUPPORTED_EXTENSIONS.has(sourceExtension)) {
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

  if ((sourceExtension === ".docx" || sourceExtension === ".pptx") && !isZip(bytes)) {
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

  if ([".txt", ".md", ".html", ".htm"].includes(sourceExtension) && !isUtf8TextLike(bytes)) {
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

export async function scanKnowledgeUpload(input: KnowledgeMalwareScanInput): Promise<KnowledgeMalwareScanResult> {
  const forced = process.env.R3MES_KNOWLEDGE_SCAN_RESULT?.trim().toUpperCase();
  if (forced === "QUARANTINED" || forced === "FAILED" || forced === "CLEAN") {
    return {
      status: forced,
      reason: forced === "CLEAN" ? undefined : "Configured by R3MES_KNOWLEDGE_SCAN_RESULT.",
    };
  }

  const text = input.bytes ? Buffer.from(input.bytes).toString("latin1") : "";
  if (text.includes(EICAR_SIGNATURE)) {
    return {
      status: "QUARANTINED",
      reason: "EICAR test signature detected.",
    };
  }

  return { status: "CLEAN" };
}
