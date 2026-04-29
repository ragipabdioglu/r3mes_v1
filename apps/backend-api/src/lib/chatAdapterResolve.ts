import { AdapterArtifactFormat, AdapterRuntime, AdapterStatus } from "@prisma/client";
import type { AnswerDomain } from "./answerSchema.js";

import { getConfiguredChatRuntime } from "./adapterRuntimeSelect.js";
import { apiError, type ApiErrorBody } from "./apiErrors.js";
import { prisma } from "./prisma.js";

/**
 * AI engine `adapter_cid` bekler. İstemci `adapter_id` / `adapter_db_id` / `on_chain_adapter_id`
 * verirse kayıttan `weightsCid` çözülür; doğrudan `adapter_cid` verilirse kayıt IPFS CID ile
 * eşlenir. MVP: tüm yollar `Adapter.status === ACTIVE` gerektirir (INTEGRATION_CONTRACT §3.5).
 *
 * Pazaryeri: herhangi bir doğrulanmış cüzdan, başka sahibin ACTIVE adaptörüyle sohbet edebilir
 * (`adapter_id` / `on_chain_adapter_id` için sahip filtresi yok).
 */
export async function resolveAdapterCidForChatProxy(opts: {
  body: Record<string, unknown>;
  answerDomain?: AnswerDomain;
}): Promise<
  | { ok: true; upstreamBody: Record<string, unknown> }
  | { ok: false; statusCode: 400; body: ApiErrorBody }
> {
  const { body, answerDomain = "general" } = opts;
  const out: Record<string, unknown> = { ...body };

  const notActive = (s: AdapterStatus): ApiErrorBody =>
    apiError(
      "ADAPTER_NOT_ACTIVE",
      s === AdapterStatus.PENDING_REVIEW
        ? "Bu adaptör henüz inceleme/benchmark aşamasında; sohbet yalnızca ACTIVE kayıtlarla açılır."
        : "Bu adaptör sohbet için uygun durumda değil (ACTIVE gerekir).",
    );

  const peftRuntimeUnavailable = (): ApiErrorBody =>
    apiError(
      "ADAPTER_RUNTIME_UNAVAILABLE",
      "Bu behavior LoRA PEFT/Transformers formatında. Yerel chat şu an llama_cpp runtime ile çalışıyor; adaptörü kaldırıp RAG-only deneyin veya R3MES_AI_RUNTIME=transformers_peft ile ayrı runtime açın.",
    );

  const canUseTransformersPeft = () => getConfiguredChatRuntime() === "transformers_peft";

  const stripAdapter = (reason: string): { ok: true; upstreamBody: Record<string, unknown> } => {
    delete out.adapter_cid;
    delete out.adapter_path;
    delete out.adapter_id;
    delete out.adapter_db_id;
    delete out.adapterDbId;
    delete out.on_chain_adapter_id;
    delete out.onChainAdapterId;
    out.adapter_disabled_reason = reason;
    return { ok: true, upstreamBody: out };
  };

  const isMedicalBehaviorAdapter = (adapter: {
    name?: string | null;
    domainTags?: string[] | null;
  }): boolean => {
    const haystack = [adapter.name ?? "", ...(adapter.domainTags ?? [])]
      .join(" ")
      .toLocaleLowerCase("tr-TR");
    return ["doctor", "medical", "health", "saglik", "sağlık", "doktor", "hekim"].some((term) =>
      haystack.includes(term),
    );
  };

  const shouldDisableForDomain = (adapter: {
    name?: string | null;
    domainTags?: string[] | null;
  }): boolean => answerDomain !== "medical" && isMedicalBehaviorAdapter(adapter);

  const useLocalLlamaGguf = (storagePath: string | null): void => {
    out.runtime = "llama_cpp";
    out.adapter_path = storagePath;
    delete out.adapter_cid;
    delete out.adapter_id;
    delete out.adapter_db_id;
    delete out.adapterDbId;
    delete out.on_chain_adapter_id;
    delete out.onChainAdapterId;
  };

  const existingCid =
    typeof out.adapter_cid === "string" && out.adapter_cid.trim().length > 0
      ? out.adapter_cid.trim()
      : null;

  if (existingCid) {
    const byCid = await prisma.adapter.findFirst({
      where: {
        OR: [{ weightsCid: existingCid }, { manifestCid: existingCid }],
      },
      select: {
        id: true,
        weightsCid: true,
        manifestCid: true,
        status: true,
        onChainAdapterId: true,
        runtime: true,
        format: true,
        storagePath: true,
        name: true,
        domainTags: true,
      },
    });
    if (!byCid) {
      return {
        ok: false,
        statusCode: 400,
        body: apiError(
          "ADAPTER_RESOLUTION_FAILED",
          "Bu IPFS CID için kayıtlı adaptör yok; yalnızca platforma yüklenmiş ACTIVE adaptörlerle sohbet açılabilir",
        ),
      };
    }
    if (byCid.status !== AdapterStatus.ACTIVE) {
      return { ok: false, statusCode: 400, body: notActive(byCid.status) };
    }
    if (shouldDisableForDomain(byCid)) {
      return stripAdapter(`medical_behavior_adapter_disabled_for_${answerDomain}`);
    }
    if (byCid.runtime === AdapterRuntime.TRANSFORMERS && byCid.format === AdapterArtifactFormat.PEFT) {
      if (!canUseTransformersPeft()) {
        return { ok: false, statusCode: 400, body: peftRuntimeUnavailable() };
      }
      if (!byCid.storagePath) {
        return {
          ok: false,
          statusCode: 400,
          body: apiError("ADAPTER_RESOLUTION_FAILED", "PEFT adaptör kaydında storagePath eksik"),
        };
      }
      out.runtime = "transformers_peft";
      out.adapter_path = byCid.storagePath;
      delete out.adapter_cid;
      delete out.adapter_id;
      delete out.adapter_db_id;
      delete out.adapterDbId;
      delete out.on_chain_adapter_id;
      delete out.onChainAdapterId;
      return { ok: true, upstreamBody: out };
    }
    if (byCid.runtime === AdapterRuntime.LLAMA_CPP && byCid.format === AdapterArtifactFormat.GGUF && byCid.storagePath) {
      useLocalLlamaGguf(byCid.storagePath);
      return { ok: true, upstreamBody: out };
    }
    const canonical = byCid.weightsCid ?? byCid.manifestCid;
    if (!canonical) {
      return {
        ok: false,
        statusCode: 400,
        body: apiError("ADAPTER_RESOLUTION_FAILED", "Adaptör kaydında IPFS CID eksik"),
      };
    }

    const dbIdRaw =
      (typeof out.adapter_db_id === "string" && out.adapter_db_id) ||
      (typeof out.adapterDbId === "string" && out.adapterDbId) ||
      (typeof out.adapter_id === "string" && out.adapter_id);
    if (dbIdRaw && typeof dbIdRaw === "string" && dbIdRaw.trim() !== byCid.id) {
      return {
        ok: false,
        statusCode: 400,
        body: apiError(
          "ADAPTER_RESOLUTION_CONFLICT",
          "adapter_cid ile adapter_id aynı ACTIVE kaydı göstermiyor",
        ),
      };
    }

    const oc = out.on_chain_adapter_id ?? out.onChainAdapterId;
    if (oc !== undefined && oc !== null && String(oc).length > 0) {
      let big: bigint;
      try {
        big = BigInt(String(oc));
      } catch {
        return {
          ok: false,
          statusCode: 400,
          body: apiError("INVALID_ON_CHAIN_ADAPTER_ID", "on_chain_adapter_id sayısal bir u64 olmalıdır"),
        };
      }
      if (byCid.onChainAdapterId === null || byCid.onChainAdapterId !== big) {
        return {
          ok: false,
          statusCode: 400,
          body: apiError(
            "ADAPTER_RESOLUTION_CONFLICT",
            "adapter_cid ile on_chain_adapter_id aynı ACTIVE kaydı göstermiyor",
          ),
        };
      }
    }

    out.adapter_cid = canonical;
    delete out.adapter_id;
    delete out.adapter_db_id;
    delete out.adapterDbId;
    delete out.on_chain_adapter_id;
    delete out.onChainAdapterId;
    return { ok: true, upstreamBody: out };
  }

  const dbIdRaw =
    (typeof out.adapter_db_id === "string" && out.adapter_db_id) ||
    (typeof out.adapterDbId === "string" && out.adapterDbId) ||
    (typeof out.adapter_id === "string" && out.adapter_id);
  if (dbIdRaw && typeof dbIdRaw === "string") {
    const id = dbIdRaw.trim();
    const adapter = await prisma.adapter.findUnique({
      where: { id },
      select: {
        weightsCid: true,
        manifestCid: true,
        status: true,
        runtime: true,
        format: true,
        storagePath: true,
        name: true,
        domainTags: true,
      },
    });
    if (adapter && adapter.status === AdapterStatus.ACTIVE && shouldDisableForDomain(adapter)) {
      return stripAdapter(`medical_behavior_adapter_disabled_for_${answerDomain}`);
    }
    if (
      adapter &&
      adapter.status === AdapterStatus.ACTIVE &&
      adapter.runtime === AdapterRuntime.TRANSFORMERS &&
      adapter.format === AdapterArtifactFormat.PEFT
    ) {
      if (!canUseTransformersPeft()) {
        return { ok: false, statusCode: 400, body: peftRuntimeUnavailable() };
      }
      if (!adapter.storagePath) {
        return {
          ok: false,
          statusCode: 400,
          body: apiError("ADAPTER_RESOLUTION_FAILED", "PEFT adaptör kaydında storagePath eksik"),
        };
      }
      out.runtime = "transformers_peft";
      out.adapter_path = adapter.storagePath;
      delete out.adapter_id;
      delete out.adapter_db_id;
      delete out.adapterDbId;
      return { ok: true, upstreamBody: out };
    }
    if (
      adapter &&
      adapter.status === AdapterStatus.ACTIVE &&
      adapter.runtime === AdapterRuntime.LLAMA_CPP &&
      adapter.format === AdapterArtifactFormat.GGUF &&
      adapter.storagePath
    ) {
      useLocalLlamaGguf(adapter.storagePath);
      return { ok: true, upstreamBody: out };
    }
    const cid = adapter?.weightsCid ?? adapter?.manifestCid;
    if (!adapter || !cid) {
      return {
        ok: false,
        statusCode: 400,
        body: apiError(
          "ADAPTER_RESOLUTION_FAILED",
          "adapter_id için kayıt yok veya IPFS CID eksik",
        ),
      };
    }
    if (adapter.status !== AdapterStatus.ACTIVE) {
      return { ok: false, statusCode: 400, body: notActive(adapter.status) };
    }
    out.adapter_cid = cid;
    delete out.adapter_id;
    delete out.adapter_db_id;
    delete out.adapterDbId;
    return { ok: true, upstreamBody: out };
  }

  const oc = out.on_chain_adapter_id ?? out.onChainAdapterId;
  if (oc !== undefined && oc !== null && String(oc).length > 0) {
    let big: bigint;
    try {
      big = BigInt(String(oc));
    } catch {
      return {
        ok: false,
        statusCode: 400,
        body: apiError("INVALID_ON_CHAIN_ADAPTER_ID", "on_chain_adapter_id sayısal bir u64 olmalıdır"),
      };
    }
    const adapter = await prisma.adapter.findUnique({
      where: { onChainAdapterId: big },
      select: {
        weightsCid: true,
        manifestCid: true,
        status: true,
        runtime: true,
        format: true,
        storagePath: true,
        name: true,
        domainTags: true,
      },
    });
    if (adapter && adapter.status === AdapterStatus.ACTIVE && shouldDisableForDomain(adapter)) {
      return stripAdapter(`medical_behavior_adapter_disabled_for_${answerDomain}`);
    }
    if (
      adapter &&
      adapter.status === AdapterStatus.ACTIVE &&
      adapter.runtime === AdapterRuntime.TRANSFORMERS &&
      adapter.format === AdapterArtifactFormat.PEFT
    ) {
      if (!canUseTransformersPeft()) {
        return { ok: false, statusCode: 400, body: peftRuntimeUnavailable() };
      }
      if (!adapter.storagePath) {
        return {
          ok: false,
          statusCode: 400,
          body: apiError("ADAPTER_RESOLUTION_FAILED", "PEFT adaptör kaydında storagePath eksik"),
        };
      }
      out.runtime = "transformers_peft";
      out.adapter_path = adapter.storagePath;
      delete out.on_chain_adapter_id;
      delete out.onChainAdapterId;
      return { ok: true, upstreamBody: out };
    }
    if (
      adapter &&
      adapter.status === AdapterStatus.ACTIVE &&
      adapter.runtime === AdapterRuntime.LLAMA_CPP &&
      adapter.format === AdapterArtifactFormat.GGUF &&
      adapter.storagePath
    ) {
      useLocalLlamaGguf(adapter.storagePath);
      return { ok: true, upstreamBody: out };
    }
    const cid = adapter?.weightsCid ?? adapter?.manifestCid;
    if (!adapter || !cid) {
      return {
        ok: false,
        statusCode: 400,
        body: apiError("ADAPTER_RESOLUTION_FAILED", "on_chain_adapter_id için kayıt yok veya erişim yok"),
      };
    }
    if (adapter.status !== AdapterStatus.ACTIVE) {
      return { ok: false, statusCode: 400, body: notActive(adapter.status) };
    }
    out.adapter_cid = cid;
    delete out.on_chain_adapter_id;
    delete out.onChainAdapterId;
    return { ok: true, upstreamBody: out };
  }

  return { ok: true, upstreamBody: out };
}
