"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import {
  fetchKnowledgeCollectionDetail,
  fetchKnowledgeCollections,
  publishKnowledgeCollection,
  unpublishKnowledgeCollection,
} from "@/lib/api/knowledge";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import type {
  KnowledgeCollectionDetail,
  KnowledgeCollectionListItem,
  KnowledgeDocumentDetail,
  KnowledgeVisibility,
} from "@/lib/types/knowledge";
import { userFacingFetchFailure } from "@/lib/ui/http-messages";
import {
  backendUrlHint,
  knowledgeStudio,
  loadingLabel,
  walletConnectForStudio,
} from "@/lib/ui/product-copy";
import {
  isLikelyWalletAuthFailure,
  userFacingWalletAuthError,
} from "@/lib/ui/wallet-auth-user-message";

function VisibilityBadge({ visibility }: { visibility: KnowledgeVisibility }) {
  const styles =
    visibility === "PUBLIC"
      ? "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40"
      : "bg-zinc-800/80 text-zinc-200 ring-zinc-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles}`}
    >
      {visibility === "PUBLIC"
        ? knowledgeStudio.visibilityPublic
        : knowledgeStudio.visibilityPrivate}
    </span>
  );
}

function readinessState(item: KnowledgeCollectionListItem): {
  label: string;
  hint: string;
  className: string;
} {
  if (item.documentCount === 0) {
    return {
      label: "Boş",
      hint: "Henüz doküman yok",
      className: "bg-zinc-800/80 text-zinc-300 ring-zinc-700",
    };
  }
  if (item.sourceQuality === "thin" || item.profileConfidence === "low") {
    return {
      label: "Temkinli",
      hint: "Profil zayıf; auto source geniş davranır",
      className: "bg-amber-500/10 text-amber-100 ring-amber-500/35",
    };
  }
  if (item.sourceQuality === "structured" || item.profileConfidence === "high") {
    return {
      label: "Hazır",
      hint: "Profil güçlü; chat kaynak seçimi için uygun",
      className: "bg-emerald-500/15 text-emerald-100 ring-emerald-500/35",
    };
  }
  return {
    label: "İndeksli",
    hint: "Profil var; kalite sinyali orta seviyede",
    className: "bg-cyan-500/10 text-cyan-100 ring-cyan-500/35",
  };
}

function ReadinessBadge({ item }: { item: KnowledgeCollectionListItem }) {
  const state = readinessState(item);
  return (
    <span
      title={state.hint}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${state.className}`}
    >
      {state.label}
    </span>
  );
}

function profileHealthState(item: KnowledgeCollectionListItem): {
  label: string;
  hint: string;
  className: string;
} {
  const score = item.profileHealthScore;
  const scoreText = typeof score === "number" ? ` · ${score}/100` : "";
  if (item.profileHealthLevel === "healthy") {
    return {
      label: `Healthy${scoreText}`,
      hint: "Profile alanları ve embedding sinyalleri güçlü.",
      className: "bg-emerald-500/15 text-emerald-100 ring-emerald-500/35",
    };
  }
  if (item.profileHealthLevel === "usable") {
    return {
      label: `Usable${scoreText}`,
      hint: "Profile kullanılabilir; zayıf sinyal varsa broad/suggest yolu korur.",
      className: "bg-cyan-500/10 text-cyan-100 ring-cyan-500/35",
    };
  }
  if (item.profileHealthLevel === "weak") {
    return {
      label: `Weak${scoreText}`,
      hint: "Profile zayıf; strict karar için temkinli davranılır.",
      className: "bg-amber-500/10 text-amber-100 ring-amber-500/35",
    };
  }
  const fallback = readinessState(item);
  return {
    label: `Profile ${fallback.label}`,
    hint: `${fallback.hint}. Health skoru için backend yeniden başlatılınca native alanlar görünür.`,
    className: fallback.className,
  };
}

function ProfileHealthBadge({ item }: { item: KnowledgeCollectionListItem }) {
  const state = profileHealthState(item);
  return (
    <span
      title={state.hint}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${state.className}`}
    >
      {state.label}
    </span>
  );
}

function profileSignal(item: KnowledgeCollectionListItem): string {
  const quality = item.sourceQuality ?? "profile";
  const confidence = item.profileConfidence ?? "unknown";
  const version = item.profileVersion ? `v${item.profileVersion}` : "v-";
  const health = item.profileHealthLevel
    ? ` / ${item.profileHealthLevel}${typeof item.profileHealthScore === "number" ? ` ${item.profileHealthScore}` : ""}`
    : "";
  return `${quality} / ${confidence} / ${version}${health}`;
}

function productHealth(item: KnowledgeCollectionListItem): {
  title: string;
  summary: string;
  nextAction: string;
  className: string;
} {
  if (item.documentCount === 0) {
    return {
      title: "Veri bekliyor",
      summary: "Bu collection henüz chat için kullanılacak doküman içermiyor.",
      nextAction: "Önce TXT/MD/JSON/PDF/DOCX/PPTX/HTML kaynak yükleyin.",
      className: "border-zinc-800 bg-zinc-950/45 text-zinc-400",
    };
  }
  if (item.sourceQuality === "thin" || item.profileConfidence === "low" || item.profileHealthLevel === "weak") {
    return {
      title: "Temkinli kullanılmalı",
      summary: "Sistem bu kaynağı görebiliyor ama profil sinyali zayıf; auto source yanlış kilitlenmemek için geniş/suggest davranır.",
      nextAction: "Daha açıklayıcı başlık, konu etiketi veya birkaç destekleyici doküman eklemek kaliteyi artırır.",
      className: "border-amber-500/20 bg-amber-950/10 text-amber-100/85",
    };
  }
  if (item.profileHealthLevel === "healthy" || item.sourceQuality === "structured" || item.profileConfidence === "high") {
    return {
      title: "Chat için hazır",
      summary: "Profil, konu ve kaynak sinyalleri güçlü; auto source bu collection'ı güvenle aday gösterebilir.",
      nextAction: item.visibility === "PUBLIC" ? "Public kullanım açık; gerekirse private'a alın." : "Sadece size açık; isterseniz publish ile public yapın.",
      className: "border-emerald-500/20 bg-emerald-950/10 text-emerald-100/85",
    };
  }
  return {
    title: "Kullanılabilir",
    summary: "Collection indeksli ve chat hattına girebilir; zor sorularda sistem ek kaynak veya öneri isteyebilir.",
    nextAction: "İlk birkaç gerçek soru ile feedback vererek profile ve router sinyallerini güçlendirin.",
    className: "border-cyan-500/20 bg-cyan-950/10 text-cyan-100/85",
  };
}

function profileWarnings(item: KnowledgeCollectionListItem): string[] {
  return (item.profileHealthWarnings ?? []).slice(0, 4);
}

function isInternalKnowledgeCollection(collection: KnowledgeCollectionListItem): boolean {
  const value = `${collection.name} ${collection.id}`.toLocaleLowerCase("tr-TR");
  return /\b(smoke|demo|test|dev|debug)\b/.test(value) || value.includes("raw legal upload");
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function statusTone(status: KnowledgeDocumentDetail["parseStatus"]): string {
  if (status === "READY") return "text-emerald-200 bg-emerald-500/10 ring-emerald-500/30";
  if (status === "FAILED") return "text-red-200 bg-red-500/10 ring-red-500/30";
  return "text-amber-100 bg-amber-500/10 ring-amber-500/30";
}

function ingestionStepTone(status: string | null | undefined): string {
  if (status === "READY") return "text-emerald-200 bg-emerald-500/10 ring-emerald-500/30";
  if (status === "PARTIAL_READY") return "text-cyan-100 bg-cyan-500/10 ring-cyan-500/30";
  if (status === "FAILED") return "text-red-200 bg-red-500/10 ring-red-500/30";
  if (status === "RUNNING" || status === "PENDING") return "text-amber-100 bg-amber-500/10 ring-amber-500/30";
  if (status === "SKIPPED") return "text-zinc-300 bg-zinc-800/60 ring-zinc-700";
  return "text-zinc-300 bg-zinc-800/60 ring-zinc-700";
}

function parseQualityTone(level: KnowledgeDocumentDetail["parseQualityLevel"]): string {
  if (level === "clean") return "text-emerald-100 bg-emerald-500/10 ring-emerald-500/30";
  if (level === "usable") return "text-cyan-100 bg-cyan-500/10 ring-cyan-500/30";
  if (level === "noisy") return "text-amber-100 bg-amber-500/10 ring-amber-500/30";
  return "text-zinc-300 bg-zinc-800/60 ring-zinc-700";
}

function parseQualityLabel(doc: KnowledgeDocumentDetail): string {
  if (!doc.parseQualityLevel) return "Parse quality yok";
  const score = typeof doc.parseQualityScore === "number" ? ` · ${doc.parseQualityScore}/100` : "";
  return `${doc.parseQualityLevel}${score}`;
}

function ingestionRiskTone(level: "none" | "low" | "medium" | "high" | undefined): string {
  if (level === "high") return "text-red-100 bg-red-500/10 ring-red-500/30";
  if (level === "medium") return "text-amber-100 bg-amber-500/10 ring-amber-500/30";
  if (level === "low") return "text-cyan-100 bg-cyan-500/10 ring-cyan-500/30";
  return "text-zinc-300 bg-zinc-800/60 ring-zinc-700";
}

function ingestionGateLabel(doc: KnowledgeDocumentDetail): string {
  if (doc.documentUnderstanding?.strictAnswerEligible === false) return "Answer strict kapalı";
  if (doc.documentUnderstanding?.answerReadiness === "needs_review") return "Answer review";
  if (doc.documentUnderstanding?.answerReadiness === "failed") return "Answer failed";
  const quality = doc.ingestionQuality;
  if (!quality) return "Ingestion gate yok";
  if (quality.thinSource) return "Thin source";
  if (!quality.strictRouteEligible) return "Strict kapalı";
  if (quality.ocrRisk === "high" || quality.tableRisk === "high") return "Temkinli gate";
  return "Strict uygun";
}

function answerReadinessTone(readiness: NonNullable<KnowledgeDocumentDetail["documentUnderstanding"]>["answerReadiness"] | undefined): string {
  if (readiness === "ready") return "text-emerald-100 bg-emerald-500/10 ring-emerald-500/30";
  if (readiness === "partial") return "text-cyan-100 bg-cyan-500/10 ring-cyan-500/30";
  if (readiness === "needs_review") return "text-amber-100 bg-amber-500/10 ring-amber-500/30";
  if (readiness === "failed") return "text-red-200 bg-red-500/10 ring-red-500/30";
  return "text-zinc-300 bg-zinc-800/60 ring-zinc-700";
}

function sortKnowledgeItems(a: KnowledgeCollectionListItem, b: KnowledgeCollectionListItem): number {
  const privateA = a.visibility === "PRIVATE" ? 0 : 1;
  const privateB = b.visibility === "PRIVATE" ? 0 : 1;
  if (privateA !== privateB) return privateA - privateB;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function KnowledgeStatusBoard() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [loading, setLoading] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeCollectionListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, KnowledgeCollectionDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const addr = account?.address;
    if (!addr) {
      setItems([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const rows = await fetchKnowledgeCollections(auth);
      setItems(rows);
    } catch (e) {
      setErr(
        isLikelyWalletAuthFailure(e)
          ? userFacingWalletAuthError(e)
          : userFacingFetchFailure("studio"),
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [account?.address, ensureAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener("r3mes-studio-knowledge-changed", onChanged);
    return () =>
      window.removeEventListener("r3mes-studio-knowledge-changed", onChanged);
  }, [load]);

  async function togglePublish(item: KnowledgeCollectionListItem) {
    setMutatingId(item.id);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      if (item.visibility === "PUBLIC") {
        await unpublishKnowledgeCollection(item.id, auth);
      } else {
        await publishKnowledgeCollection(item.id, auth);
      }
      await load();
    } catch (e) {
      setErr(
        isLikelyWalletAuthFailure(e)
          ? userFacingWalletAuthError(e)
          : knowledgeStudio.publishMutationError,
      );
    } finally {
      setMutatingId(null);
    }
  }

  async function toggleDetail(item: KnowledgeCollectionListItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    if (details[item.id]) return;
    setDetailLoadingId(item.id);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const detail = await fetchKnowledgeCollectionDetail(item.id, auth);
      if (detail) {
        setDetails((current) => ({ ...current, [item.id]: detail }));
      }
    } catch (e) {
      setErr(
        isLikelyWalletAuthFailure(e)
          ? userFacingWalletAuthError(e)
          : userFacingFetchFailure("studio"),
      );
    } finally {
      setDetailLoadingId(null);
    }
  }

  if (!account?.address) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-500">
        {walletConnectForStudio}
      </div>
    );
  }

  const searchTerm = search.trim().toLocaleLowerCase("tr-TR");
  const hiddenInternalCount = items.filter(isInternalKnowledgeCollection).length;
  const visibleItems = items
    .filter((item) => showInternal || !isInternalKnowledgeCollection(item))
    .filter((item) => {
      if (!searchTerm) return true;
      return `${item.name} ${item.id} ${item.visibility}`.toLocaleLowerCase("tr-TR").includes(searchTerm);
    })
    .sort(sortKnowledgeItems);
  const publicCount = items.filter((item) => item.visibility === "PUBLIC").length;
  const privateCount = items.filter((item) => item.visibility === "PRIVATE").length;
  const readyCount = items.filter((item) => readinessState(item).label === "Hazır").length;
  const cautiousCount = items.filter((item) => readinessState(item).label === "Temkinli").length;
  const healthyProfileCount = items.filter((item) => item.profileHealthLevel === "healthy").length;
  const usableProfileCount = items.filter((item) => item.profileHealthLevel === "usable").length;
  const weakProfileCount = items.filter((item) => item.profileHealthLevel === "weak").length;
  const documentCount = items.reduce((sum, item) => sum + item.documentCount, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            {knowledgeStudio.statusBoardTitle}
          </h2>
          <p className="text-xs leading-relaxed text-zinc-500">
            {knowledgeStudio.statusBoardHint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-cyan-300 hover:text-cyan-200"
        >
          Yenile
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div className="rounded-2xl border border-r3mes-border bg-r3mes-surface/45 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Collection
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{items.length}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {privateCount} private · {publicCount} public
          </p>
        </div>
        <div className="rounded-2xl border border-r3mes-border bg-r3mes-surface/45 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Doküman
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{documentCount}</p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Chat kaynak havuzuna giren içerik
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100/70">
            Hazır profil
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-50">{readyCount}</p>
          <p className="mt-1 text-[11px] text-emerald-100/60">
            {healthyProfileCount + usableProfileCount > 0
              ? `${healthyProfileCount} healthy · ${usableProfileCount} usable`
              : "Auto source için güçlü sinyal"}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-100/70">
            Temkinli
          </p>
          <p className="mt-2 text-2xl font-semibold text-amber-50">{cautiousCount}</p>
          <p className="mt-1 text-[11px] text-amber-100/60">
            {weakProfileCount > 0 ? `${weakProfileCount} weak profile` : "Thin/low profile, broad fallback"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Koleksiyon ara…"
          className="min-h-[36px] min-w-[220px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
        {hiddenInternalCount > 0 ? (
          <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showInternal}
              onChange={(e) => setShowInternal(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-cyan-500/40"
            />
            Test/demo göster ({hiddenInternalCount})
          </label>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">{loadingLabel}</p>
      ) : err ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-sm text-amber-100/90">
          <p className="font-medium">{err}</p>
          <p className="mt-2 text-xs text-zinc-500">{backendUrlHint}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm leading-relaxed text-zinc-500">
          {knowledgeStudio.emptyState}
        </p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm leading-relaxed text-zinc-500">
          Filtreye uyan knowledge koleksiyonu yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => (
            <li
              key={item.id}
              className="space-y-3 rounded-xl border border-r3mes-border bg-r3mes-surface/50 px-4 py-3"
            >
              {(() => {
                const health = productHealth(item);
                return (
                  <div className={`rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${health.className}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-current">{health.title}</p>
                      <span className="text-[10px] uppercase tracking-wider opacity-60">
                        Chat hazırlığı
                      </span>
                    </div>
                    <p className="mt-1 opacity-80">{health.summary}</p>
                    <p className="mt-1 opacity-60">{health.nextAction}</p>
                  </div>
                );
              })()}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-zinc-100">
                      {item.name}
                    </p>
                    <VisibilityBadge visibility={item.visibility} />
                    <ReadinessBadge item={item} />
                    <ProfileHealthBadge item={item} />
                  </div>
                  <p className="truncate font-mono text-[11px] text-zinc-500">
                    {shortId(item.id)}
                  </p>
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    {readinessState(item).hint}
                  </p>
                  {profileWarnings(item).length > 0 ? (
                    <p className="text-[11px] leading-relaxed text-amber-100/70">
                      Profile warning: {profileWarnings(item).join(", ")}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      mutatingId === item.id ||
                      item.documentCount === 0
                    }
                    onClick={() => void togglePublish(item)}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-1.5 text-xs font-medium text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {item.visibility === "PUBLIC"
                      ? knowledgeStudio.unpublishAction
                      : knowledgeStudio.publishAction}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleDetail(item)}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700"
                  >
                    {expandedId === item.id ? "Detayı kapat" : "Detay"}
                  </button>
                </div>
              </div>

              <dl className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <dt className="text-zinc-500">
                    {knowledgeStudio.documentsLabel}
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {item.documentCount ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">
                    {knowledgeStudio.chunksLabel}
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {details[item.id]?.documents.reduce((sum, doc) => sum + doc.chunkCount, 0) ?? "Detayda"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">
                    Profil
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {profileSignal(item)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">
                    {knowledgeStudio.updatedLabel}
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString("tr-TR") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">
                    {knowledgeStudio.publishedLabel}
                  </dt>
                  <dd className="mt-1 text-zinc-200">
                    {item.publishedAt
                      ? new Date(item.publishedAt).toLocaleString("tr-TR")
                      : knowledgeStudio.notPublished}
                  </dd>
                </div>
              </dl>

              {item.inferredTopic || item.inferredTags?.length || item.lastProfiledAt ? (
                <div className="rounded-xl border border-zinc-800/70 bg-black/10 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                  {item.inferredTopic ? (
                    <p>
                      <span className="text-zinc-500">Algılanan konu:</span>{" "}
                      <span className="text-zinc-200">{item.inferredTopic}</span>
                    </p>
                  ) : null}
                  {item.inferredTags?.length ? (
                    <p className="mt-1">
                      <span className="text-zinc-500">Tag:</span>{" "}
                      {item.inferredTags.slice(0, 8).map((tag) => (
                        <span
                          key={tag}
                          className="mr-1 inline-flex rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {item.lastProfiledAt ? (
                    <p className="mt-1 text-zinc-500">
                      Son profil: {new Date(item.lastProfiledAt).toLocaleString("tr-TR")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {expandedId === item.id ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/35 p-3">
                  {detailLoadingId === item.id ? (
                    <p className="text-xs text-zinc-500">{loadingLabel}</p>
                  ) : details[item.id]?.documents.length ? (
                    <ul className="space-y-2">
                      {details[item.id].documents.map((doc) => (
                        <li
                          key={doc.id}
                          className="rounded-lg border border-zinc-800/80 bg-black/20 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-zinc-100">
                                {doc.title}
                              </p>
                              <p className="mt-1 font-mono text-[10px] text-zinc-600">
                                {shortId(doc.id)}
                                {doc.storageCid ? ` · CID ${shortId(doc.storageCid)}` : ""}
                              </p>
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusTone(doc.parseStatus)}`}>
                              {doc.parseStatus}
                            </span>
                            {doc.readinessStatus ? (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${ingestionStepTone(doc.readinessStatus)}`}>
                                Ready {doc.readinessStatus}
                              </span>
                            ) : null}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${parseQualityTone(doc.parseQualityLevel)}`}>
                              {parseQualityLabel(doc)}
                            </span>
                            {doc.ingestionQuality ? (
                              <>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${ingestionRiskTone(doc.ingestionQuality.ocrRisk)}`}>
                                  OCR {doc.ingestionQuality.ocrRisk}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${ingestionRiskTone(doc.ingestionQuality.tableRisk)}`}>
                                  Table {doc.ingestionQuality.tableRisk}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${doc.ingestionQuality.strictRouteEligible ? "text-emerald-100 bg-emerald-500/10 ring-emerald-500/30" : "text-amber-100 bg-amber-500/10 ring-amber-500/30"}`}>
                                  {ingestionGateLabel(doc)}
                                </span>
                              </>
                            ) : null}
                            {doc.documentUnderstanding ? (
                              <>
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${answerReadinessTone(doc.documentUnderstanding.answerReadiness)}`}>
                                  Answer {doc.documentUnderstanding.answerReadiness}
                                </span>
                                <span className="rounded-full bg-zinc-800/70 px-2 py-0.5 text-[10px] font-medium text-zinc-200 ring-1 ring-zinc-700">
                                  Structure {doc.documentUnderstanding.structureQuality} / Table {doc.documentUnderstanding.tableQuality}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <dl className="mt-2 grid gap-2 text-[11px] text-zinc-500 sm:grid-cols-3 lg:grid-cols-6">
                            <div>
                              <dt>Tip</dt>
                              <dd className="mt-0.5 text-zinc-300">{doc.sourceExtension ?? doc.sourceType}</dd>
                            </div>
                            <div>
                              <dt>Chunk</dt>
                              <dd className="mt-0.5 text-zinc-300">{doc.chunkCount} / artifact {doc.artifactCount ?? 0}</dd>
                            </div>
                            <div>
                              <dt>Storage / scan</dt>
                              <dd className="mt-0.5 text-zinc-300">{doc.storageStatus ?? "—"} / {doc.scanStatus ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Vector</dt>
                              <dd className="mt-0.5 text-zinc-300">{doc.vectorIndexStatus ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Parser</dt>
                              <dd className="mt-0.5 truncate text-zinc-300">{doc.parserId ?? "—"}</dd>
                            </div>
                            <div>
                              <dt>Güncelleme</dt>
                              <dd className="mt-0.5 text-zinc-300">
                                {new Date(doc.updatedAt).toLocaleString("tr-TR")}
                              </dd>
                            </div>
                          </dl>
                          {doc.inferredTopic || doc.inferredTags?.length ? (
                            <div className="mt-2 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2 py-1.5 text-[11px] text-zinc-400">
                              {doc.inferredTopic ? (
                                <p>
                                  <span className="text-zinc-500">Algılanan konu:</span>{" "}
                                  <span className="text-zinc-200">{doc.inferredTopic}</span>
                                </p>
                              ) : null}
                              {doc.inferredTags?.length ? (
                                <p className="mt-1">
                                  <span className="text-zinc-500">Tag:</span>{" "}
                                  {doc.inferredTags.slice(0, 8).map((tag) => (
                                    <span
                                      key={tag}
                                      className="mr-1 inline-flex rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {doc.parseQualityWarnings?.length ? (
                            <p className="mt-2 text-[11px] leading-relaxed text-amber-100/70">
                              Parse warning: {doc.parseQualityWarnings.slice(0, 4).join(", ")}
                            </p>
                          ) : null}
                          {doc.ingestionQuality?.warnings.length ? (
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
                              Ingestion warning: {doc.ingestionQuality.warnings.slice(0, 5).join(", ")}
                            </p>
                          ) : null}
                          {doc.documentUnderstanding?.warnings.length || doc.documentUnderstanding?.blockers.length ? (
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
                              Understanding: {[...(doc.documentUnderstanding.blockers ?? []), ...(doc.documentUnderstanding.warnings ?? [])].slice(0, 5).join(", ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-zinc-500">Bu collection için doküman detayı yok.</p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
