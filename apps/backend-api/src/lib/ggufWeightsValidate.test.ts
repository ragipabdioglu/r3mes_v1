import { describe, expect, it } from "vitest";
import { validatePrimerGgufWeights } from "./ggufWeightsValidate.js";

function ggufBytes(extra = 8): Buffer {
  const b = Buffer.alloc(4 + extra);
  Buffer.from("GGUF", "ascii").copy(b, 0);
  return b;
}

describe("validatePrimerGgufWeights", () => {
  it("kabul: GGUF sihri + .gguf adı", () => {
    const r = validatePrimerGgufWeights(ggufBytes(), "lora.gguf");
    expect(r.ok).toBe(true);
  });
  it("kabul: dosya adı yok → weights.gguf varsayımı", () => {
    const r = validatePrimerGgufWeights(ggufBytes(), "");
    expect(r.ok).toBe(true);
  });
  it("red: çok kısa", () => {
    const r = validatePrimerGgufWeights(Buffer.from([1, 2, 3]), "x.gguf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject.error).toBe("WEIGHTS_TOO_SMALL");
  });
  it("red: ZIP/PK sihri (yanlış format)", () => {
    const r = validatePrimerGgufWeights(Buffer.from([0x50, 0x4b, 3, 4, 0]), "x.gguf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject.error).toBe("INVALID_GGUF_MAGIC");
  });
  it("red: uzantı .gguf değil", () => {
    const r = validatePrimerGgufWeights(ggufBytes(), "model.safetensors");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reject.error).toBe("WEIGHTS_FILENAME_GGUF");
  });
});
