/** GGUF v2/v3 — ilk dört bayt (llama.cpp ile uyumlu). */
const GGUF_MAGIC = Buffer.from("GGUF", "ascii");

export type GgufWeightsReject = { error: string; message: string };

/**
 * POST /v1/adapters — tek primer LoRA GGUF (§3.3.1).
 * İçerik: ilk 4 bayt GGUF sihirli kelimesi; dosya adı `.gguf` ile bitmeli (varsayılan `weights.gguf`).
 */
export function validatePrimerGgufWeights(buf: Buffer, filename: string): { ok: true } | { ok: false; reject: GgufWeightsReject } {
  const name = (filename || "weights.gguf").trim();
  if (buf.length < 4) {
    return {
      ok: false,
      reject: {
        error: "WEIGHTS_TOO_SMALL",
        message: "GGUF dosyası için içerik çok kısa (en az 4 bayt gerekli)",
      },
    };
  }
  if (!buf.subarray(0, 4).equals(GGUF_MAGIC)) {
    return {
      ok: false,
      reject: {
        error: "INVALID_GGUF_MAGIC",
        message: "Beklenen llama.cpp uyumlu GGUF: ilk 4 bayt 'GGUF' olmalı",
      },
    };
  }
  if (!/\.gguf$/i.test(name)) {
    return {
      ok: false,
      reject: {
        error: "WEIGHTS_FILENAME_GGUF",
        message: "Weights dosya adı .gguf ile bitmeli (tek primer artefact)",
      },
    };
  }
  return { ok: true };
}
