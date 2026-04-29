/**
 * Faz 3 — Sözleşme invariant’ları (runtime). INTEGRATION_CONTRACT §1, §4 ile uyumlu.
 * İhlal: bilinçli breaking veya bug; sessizce yutulmamalı.
 */

export class ContractInvariantError extends Error {
  readonly code = "CONTRACT_INVARIANT_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "ContractInvariantError";
  }
}

/** §1 — QA / kuyruk bağlamında adapterCid, weights ile aynı artefaktı işaret etmeli */
export function assertAdapterCidEqualsWeightsCid(adapterCid: string, weightsCid: string): void {
  const a = adapterCid.trim();
  const w = weightsCid.trim();
  if (a !== w) {
    throw new ContractInvariantError(
      `adapterCid must equal weightsCid (Faz 2 §1); got adapterCid=${a} weightsCid=${w}`,
    );
  }
}

/** §4 — benchmarkScore ürün özeti aralığı (null = henüz yok) */
export function assertBenchmarkScoreSemantic(score: number | null | undefined): void {
  if (score === null || score === undefined) return;
  if (Number.isNaN(score) || score < 0 || score > 100) {
    throw new ContractInvariantError(
      `benchmarkScore must be null or 0..100 (Faz 2 §4); got ${String(score)}`,
    );
  }
}
