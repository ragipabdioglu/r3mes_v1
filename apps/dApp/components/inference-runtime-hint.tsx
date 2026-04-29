"use client";

import { getOptionalInferenceRuntimePublicLine } from "@/lib/env";

/**
 * ORTAK/resmi hat kararı sonrası tek satır bağlam. Env yoksa null render (sıfır yüzey değişikliği).
 * Flip günü metni: `BITNET_DEFAULT_RUNTIME_PUBLIC_LINE` (`@/lib/ui/product-copy`).
 */
export function InferenceRuntimeHint() {
  const line = getOptionalInferenceRuntimePublicLine();
  if (!line) return null;
  return (
    <p className="max-w-2xl text-[11px] leading-relaxed text-zinc-500">
      {line}
    </p>
  );
}
