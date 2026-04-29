/**
 * FE ürün sözleşmesi — drift önleme tek kaynağı.
 *
 * ORTAK / API değişince bu dosya ve doğrudan bağlı çağrılar güncellenir.
 * - Studio: ana yüzey knowledge upload; behavior LoRA ikincil yüzeydir ve primer artefact
 *   llama.cpp uyumlu LoRA GGUF (.gguf) olarak kalır.
 * - Pazaryeri: MVP’de behavior adapter listesi olarak kalır; knowledge katmanı chat’te source
 *   seçimi ile kullanılır.
 * - Sohbet: adapter veya IPFS CID opsiyoneldir; knowledge source selection birinci sınıf girdidir.
 */

/** Multipart alan adı — backend `POST /v1/adapters` ile aynı kalmalı */
export const STUDIO_MULTIPART_FIELD_WEIGHTS = "weights" as const;

export const STUDIO_WEIGHT_EXTENSION = ".gguf" as const;

export function isStudioWeightFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(STUDIO_WEIGHT_EXTENSION);
}

/** `<input type="file" accept>` — GGUF dışı uzantı eklemeyin (ORTAK onayı olmadan). */
export const STUDIO_FILE_INPUT_ACCEPT = ".gguf,.json,application/json";

/** `GET /v1/adapters` — pazaryeri kartları yalnızca bu statü */
export const MARKETPLACE_ADAPTER_QUERY_STATUS = "ACTIVE" as const;

/**
 * Yerel / QA dev bypass ile ACTIVE yapılan test adaptörleri `domainTags` içinde taşımalı.
 * Böylece pazaryeri kartı gerçek benchmark onayı gibi görünmez. İsteğe bağlı env ile ID eşlemesi: `NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS`.
 */
export const R3MES_DEV_TEST_DOMAIN_TAG = "r3mes:dev-test" as const;

/**
 * Legacy not: chat artık adaptörsüz de çalışabilir; adapter yalnız style/persona içindir.
 */
export const CHAT_REQUIRES_ADAPTER_OR_CID = false as const;

/** Kullanıcıya gösterilen kısa metinler — yalnızca buradan veya re-export ile tüketin */
export const studioUpload = {
  dropzoneHelp:
    "Zorunlu: tam olarak bir llama.cpp uyumlu LoRA GGUF (.gguf); ikinci weights dosyası gönderilemez. Sunucuda Safetensors’tan GGUF’a dönüşüm yok. İsteğe bağlı: manifest (ör. manifest.json). İmzalı oturumla gönderilir.",
  fileListLabel: "LoRA GGUF (tek dosya)",
  validationNeedGguf:
    "Bir .gguf dosyası gerekir (llama.cpp uyumlu LoRA; tek primer artefact).",
} as const;
