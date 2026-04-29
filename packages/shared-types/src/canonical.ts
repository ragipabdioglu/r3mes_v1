/**
 * Kanonik kimlik ve alan anlamları — API / DB / kuyruk / QA ile uyum için tek referans.
 * Uygulama kodu bu isimleri tüketir; Prisma şeması doğruluk kaynağıdır (Adapter.id, enumlar).
 */

/** Tek ana kimlik (off-chain): PostgreSQL `Adapter.id` (cuid). Tüm REST `.../adapters/:id` yolları bunu kullanır. */
export type AdapterDbId = string;

/**
 * Zincir sıra numarası: Move `adapter_registry::Adapter.adapter_id` (u64).
 * API’de string; indekslenmemiş kayıtta yoktur.
 */
export type OnChainAdapterId = string;

/** Sui paylaşımlı `Adapter` nesnesinin Object ID’si (0x…). */
export type OnChainObjectId = string;

/**
 * IPFS içerik kimliği — tek bir pinlenmiş nesne (dosya veya dizin kökü).
 * QA / benchmark ve chat için birincil artefakt CID’si (`weightsCid` / `adapter_cid`):
 * **llama.cpp uyumlu LoRA GGUF** tek dosyası — bkz. `docs/api/INTEGRATION_CONTRACT.md` §3.3.1.
 */
export type IpfsCid = string;

/**
 * Kimlik özeti: ana kimlik `adapterDbId`; diğerleri aynı adaptör için bağlayıcıdır.
 * `adapterCid` (webhook/kuyruk) benchmark bağlamında `weightsCid` ile aynı CID olmalıdır.
 */
export interface AdapterIdentity {
  /** Ana kimlik — her zaman dolu (API kaydı varsa). */
  adapterDbId: AdapterDbId;
  /** İndeks + zincir kaydı varsa. */
  onChainAdapterId?: OnChainAdapterId | null;
  /** Zincir nesnesi yayınlandıysa. */
  onChainObjectId?: OnChainObjectId | null;
  /**
   * IPFS: birincil LoRA GGUF (`weightsCid`) — çıkarım/QA ile aynı baytlar.
   * `adapterCid` / `ipfsCid` ile ilişki: bkz. INTEGRATION_CONTRACT §5 ve §3.3.1.
   */
  weightsCid?: IpfsCid | null;
  manifestCid?: IpfsCid | null;
}

/**
 * Wire format (Prisma `AdapterStatus`) — backend liste/detay ve istemci gösterimi bunu kullanır.
 * Move zincir durumu (u8) ile birebir değildir; eşleme aşağıda.
 */
export const AdapterStatusWire = {
  PENDING_REVIEW: "PENDING_REVIEW",
  ACTIVE: "ACTIVE",
  REJECTED: "REJECTED",
  SLASHED: "SLASHED",
  DEPRECATED: "DEPRECATED",
} as const;

export type AdapterStatusWire = (typeof AdapterStatusWire)[keyof typeof AdapterStatusWire];

/** Move `adapter_registry` durum sabitleri (u8) — yalnızca zincir okuma / indexer için. */
export const MoveAdapterStatusU8 = {
  PENDING: 0,
  ACTIVE: 1,
  REJECTED: 2,
} as const;

/**
 * Alan sözlüğü (tek anlam) — tam metin: `docs/api/INTEGRATION_CONTRACT.md` §5.
 * - `benchmarkScore`: QA sonrası 0–100 kalite özeti (DB).
 * - `rougeScore`: üst düzey alan yok; ROUGE `QaResultWebhookPayload.metrics` içinde.
 * - `weightsCid` / `manifestCid` / türetilmiş `ipfsCid`: bkz. sözleşme belgesi.
 */
