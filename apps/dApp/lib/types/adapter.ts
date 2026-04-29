/**
 * Kanonik adaptör listesi — `packages/shared-types` ile hizalı.
 * Üst düzey ROUGE alanı yok; `benchmarkScore` (0–100) kullanılır.
 */
import type { AdapterListItem, AdapterListResponse } from "@r3mes/shared-types";

export type { AdapterListItem };

export function isAdapterListResponse(json: unknown): json is AdapterListResponse {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  return Array.isArray(o.data);
}

/** Yüksek skor önce; skorsuz kayıtlar sonda. */
export function sortAdaptersByBenchmark(
  rows: AdapterListItem[],
): AdapterListItem[] {
  return [...rows].sort((a, b) => {
    const sa = a.benchmarkScore;
    const sb = b.benchmarkScore;
    if (sa == null && sb == null) return 0;
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb - sa;
  });
}
