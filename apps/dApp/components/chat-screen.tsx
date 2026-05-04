"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { DevTestPill } from "@/components/dev-test-pill";
import { fetchAdapterChatMetadata } from "@/lib/api/adapter-detail";
import {
  streamChatCompletions,
  type ChatMessage,
} from "@/lib/api/chat-stream";
import { fetchKnowledgeCollections } from "@/lib/api/knowledge";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import { isDevTestAdapter } from "@/lib/types/adapter-dev-test";
import type {
  ChatRetrievalDebug,
  ChatSourceCitation,
  KnowledgeCollectionListItem,
} from "@/lib/types/knowledge";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import { getChatDebugEnabled } from "@/lib/env";
import {
  chat,
  walletConnectForChatAction,
} from "@/lib/ui/product-copy";
import {
  isLikelyWalletAuthFailure,
  userFacingWalletAuthError,
} from "@/lib/ui/wallet-auth-user-message";

const TEMPLATE_TOKEN_RE = /<\/?\|im_(?:start|end)\|>/g;
const CHAT_DEBUG_ENABLED = getChatDebugEnabled();

const SUGGESTED_PROMPTS = [
  "Seçili kaynaklara göre bu konuyu kısa ve net açıkla.",
  "Bu kaynakta hangi durumlarda dikkatli olunmalı?",
  "Production migration öncesi neyi kontrol etmeliyim?",
  "Smear sonucum temiz ama kasık ağrım var. Ne yapmalıyım?",
];

type ChatTurn = ChatMessage & {
  sources?: ChatSourceCitation[];
  retrievalDebug?: ChatRetrievalDebug;
};

type KnowledgeDomainFilter = "auto" | "all" | "medical" | "legal" | "technical" | "education" | "finance";

const KNOWLEDGE_DOMAIN_FILTERS: Array<{ id: KnowledgeDomainFilter; label: string }> = [
  { id: "auto", label: "Otomatik" },
  { id: "all", label: "Tümü" },
  { id: "medical", label: "Sağlık" },
  { id: "legal", label: "Hukuk" },
  { id: "technical", label: "Teknik" },
  { id: "education", label: "Eğitim" },
  { id: "finance", label: "Finans" },
];

const KNOWLEDGE_DOMAIN_LABELS: Record<Exclude<KnowledgeDomainFilter, "auto" | "all">, string> = {
  medical: "Sağlık",
  legal: "Hukuk",
  technical: "Teknik",
  education: "Eğitim",
  finance: "Finans",
};

function knownKnowledgeDomain(value?: string | null): Exclude<KnowledgeDomainFilter, "auto" | "all"> | null {
  if (
    value === "medical" ||
    value === "legal" ||
    value === "technical" ||
    value === "education" ||
    value === "finance"
  ) {
    return value;
  }
  return null;
}

function isInternalKnowledgeCollection(collection: KnowledgeCollectionListItem): boolean {
  const value = `${collection.name} ${collection.id}`.toLocaleLowerCase("tr-TR");
  return /\b(smoke|demo|test|dev|debug)\b/.test(value) || value.includes("raw legal upload");
}

function inferKnowledgeDomain(text: string): Exclude<KnowledgeDomainFilter, "auto" | "all"> | null {
  const value = text.toLocaleLowerCase("tr-TR");
  if (/(smear|rahim|kasık|jinekoloji|onkoloji|doktor|hasta|tahlil|kanser|kist|gebelik|hamile|ağrı|agri|sağlık|saglik|medical|gyn)/.test(value)) {
    return "medical";
  }
  if (/(hukuk|dava|boşanma|bosanma|avukat|mahkeme|sözleşme|sozlesme|icra|tazminat|legal|law)/.test(value)) {
    return "legal";
  }
  if (/(database|veritabanı|migration|deploy|rollback|api|sunucu|log|postgres|redis|docker|teknik|technical|kod|server)/.test(value)) {
    return "technical";
  }
  if (/(eğitim|egitim|öğrenci|ogrenci|sınav|sinav|ders|okul|müfredat|mufredat|education)/.test(value)) {
    return "education";
  }
  if (/(finans|yatırım|yatirim|bütçe|butce|kredi|faiz|borsa|vergi|muhasebe|finance)/.test(value)) {
    return "finance";
  }
  return null;
}

function collectionDomain(collection: KnowledgeCollectionListItem): Exclude<KnowledgeDomainFilter, "auto" | "all"> | null {
  const backendDomain = knownKnowledgeDomain(collection.inferredDomain);
  if (backendDomain) return backendDomain;
  const metadata = `${collection.inferredTopic ?? ""} ${(collection.inferredTags ?? []).join(" ")}`.trim();
  return inferKnowledgeDomain(metadata) ?? inferKnowledgeDomain(`${collection.name} ${collection.id}`);
}

function profileQualityLabel(collection: KnowledgeCollectionListItem): string | null {
  if (!collection.sourceQuality && !collection.profileConfidence) return null;
  const quality = collection.sourceQuality ?? "profile";
  const confidence = collection.profileConfidence ? `/${collection.profileConfidence}` : "";
  return `${quality}${confidence}`;
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatCollectionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

function sortCollections(a: KnowledgeCollectionListItem, b: KnowledgeCollectionListItem): number {
  const selectedA = a.visibility === "PRIVATE" ? 0 : 1;
  const selectedB = b.visibility === "PRIVATE" ? 0 : 1;
  if (selectedA !== selectedB) return selectedA - selectedB;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function searchMatchesCollection(collection: KnowledgeCollectionListItem, searchTerm: string): boolean {
  if (!searchTerm) return true;
  return `${collection.name} ${collection.id} ${collection.visibility} ${collection.inferredTopic ?? ""} ${(collection.inferredTags ?? []).join(" ")}`
    .toLocaleLowerCase("tr-TR")
    .includes(searchTerm);
}

function rankRecommendedCollections(
  rows: KnowledgeCollectionListItem[],
  selectedIds: string[],
  activeDomain: Exclude<KnowledgeDomainFilter, "auto" | "all"> | null,
): KnowledgeCollectionListItem[] {
  return [...rows]
    .sort((a, b) => {
      const selectedA = selectedIds.includes(a.id) ? 0 : 1;
      const selectedB = selectedIds.includes(b.id) ? 0 : 1;
      if (selectedA !== selectedB) return selectedA - selectedB;

      const domainA = activeDomain && collectionDomain(a) === activeDomain ? 0 : 1;
      const domainB = activeDomain && collectionDomain(b) === activeDomain ? 0 : 1;
      if (domainA !== domainB) return domainA - domainB;

      const docA = a.documentCount > 0 ? 0 : 1;
      const docB = b.documentCount > 0 ? 0 : 1;
      if (docA !== docB) return docA - docB;

      return sortCollections(a, b);
    })
    .slice(0, 6);
}

function groupKnowledgeCollections(
  rows: KnowledgeCollectionListItem[],
  selectedIds: string[],
): Array<{ id: string; title: string; hint: string; items: KnowledgeCollectionListItem[] }> {
  const privateItems = rows.filter((item) => item.visibility === "PRIVATE");
  const publicItems = rows.filter((item) => item.visibility === "PUBLIC" && !isInternalKnowledgeCollection(item));
  const internalItems = rows.filter(isInternalKnowledgeCollection);
  const order = (a: KnowledgeCollectionListItem, b: KnowledgeCollectionListItem) => {
    const aSelected = selectedIds.includes(a.id) ? 0 : 1;
    const bSelected = selectedIds.includes(b.id) ? 0 : 1;
    if (aSelected !== bSelected) return aSelected - bSelected;
    return sortCollections(a, b);
  };

  return [
    {
      id: "private",
      title: "Private kaynaklar",
      hint: "Sadece cüzdanınıza ait collection'lar. Büro/kişisel veri için ana alan burası.",
      items: privateItems.sort(order),
    },
    {
      id: "public",
      title: "Public kaynaklar",
      hint: "Herkese açık collection'lar. Seçerseniz cevap yalnız seçilen kaynaklarla sınırlanır.",
      items: publicItems.sort(order),
    },
    {
      id: "internal",
      title: "Test/demo kaynaklar",
      hint: "Eval ve geliştirme verileri. Normal kullanıcı akışında gizli kalmalı.",
      items: internalItems.sort(order),
    },
  ].filter((group) => group.items.length > 0);
}

function VisibilityPill({ visibility }: { visibility: KnowledgeCollectionListItem["visibility"] }) {
  const isPublic = visibility === "PUBLIC";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
        isPublic
          ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/35"
          : "bg-zinc-800 text-zinc-200 ring-zinc-700"
      }`}
    >
      {isPublic ? "PUBLIC" : "PRIVATE"}
    </span>
  );
}

function sanitizeAssistantText(text: string): string {
  return text.replace(TEMPLATE_TOKEN_RE, "");
}

function SourceList({
  sources,
  collections,
}: {
  sources?: ChatSourceCitation[];
  collections: KnowledgeCollectionListItem[];
}) {
  if (!sources || sources.length === 0) {
    return null;
  }

  const visibleSources = sources.slice(0, 3);
  const hiddenSourceCount = Math.max(0, sources.length - visibleSources.length);

  return (
    <details className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/35 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-500/25 bg-emerald-950/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100">
              {sources.length} kaynak
            </span>
            <span className="text-[11px] text-zinc-500">
              Yanıt kaynaklı üretildi
            </span>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Detay
          </span>
        </div>
      </summary>
      <ul className="mt-3 space-y-2">
        {visibleSources.map((source, index) => {
          const collection = collections.find((item) => item.id === source.collectionId);
          return (
            <li
              key={`${source.collectionId}-${source.documentId ?? index}-${source.chunkIndex ?? 0}`}
              className="rounded-xl border border-zinc-800 bg-black/20 px-3 py-2 text-[11px] text-zinc-400"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-100">{source.title}</span>
                {collection ? <VisibilityPill visibility={collection.visibility} /> : null}
                <span className="font-mono text-[10px] text-zinc-600">
                  {shortId(source.collectionId)}
                  {source.chunkIndex != null ? ` · chunk ${source.chunkIndex}` : ""}
                </span>
              </div>
              {source.excerpt ? (
                <p className="mt-1 line-clamp-3 leading-relaxed text-zinc-500">
                  {source.excerpt}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hiddenSourceCount > 0 ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          {hiddenSourceCount} ek kaynak daha gizlendi.
        </p>
      ) : null}
    </details>
  );
}

function RetrievalDebugPanel({
  debug,
  visible,
}: {
  debug?: ChatRetrievalDebug;
  visible: boolean;
}) {
  if (!visible || !debug) return null;
  const facts = debug.evidence?.usableFacts ?? [];
  const routePlan = debug.routePlan ?? debug.queryPlan?.routePlan;
  const sourceSelection = debug.sourceSelection;
  const uncertain = [
    ...(debug.evidence?.uncertainOrUnusable ?? []),
    ...(debug.evidence?.missingInfo ?? []),
  ];
  const redFlags = debug.evidence?.redFlags ?? [];

  return (
    <details className="mt-3 rounded-xl border border-zinc-800/80 bg-black/20 p-3 text-[11px] leading-relaxed text-zinc-400">
      <summary className="cursor-pointer text-zinc-300">
        Kanıt özeti · domain: {debug.domain} · grounding: {debug.groundingConfidence}
      </summary>
      {facts.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium text-zinc-300">Kullanılan gerçekler</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {facts.slice(0, 4).map((fact, index) => (
              <li key={`fact-${index}`}>{fact}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {routePlan ? (
        <div className="mt-2">
          <p className="font-medium text-zinc-300">Route plan</p>
          <p className="mt-1 font-mono text-zinc-500">
            domain={routePlan.domain} · subtopics={routePlan.subtopics.join(", ") || "-"} · risk={routePlan.riskLevel} · confidence={routePlan.confidence}
          </p>
        </div>
      ) : null}
      {sourceSelection ? (
        <div className="mt-2">
          <p className="font-medium text-zinc-300">Kaynak seçimi</p>
          <p className="mt-1 font-mono text-zinc-500">
            mode={sourceSelection.selectionMode} · route={sourceSelection.routeDomain ?? "-"} · accessible={sourceSelection.accessibleCollectionIds.length} · used={sourceSelection.usedCollectionIds.length}
          </p>
          {sourceSelection.warning ? (
            <p className="mt-1 text-amber-100/90">{sourceSelection.warning}</p>
          ) : null}
          {sourceSelection.usedCollectionIds.length > 0 ? (
            <p className="mt-1 font-mono text-zinc-500">
              used: {sourceSelection.usedCollectionIds.map(shortId).join(", ")}
            </p>
          ) : null}
          {sourceSelection.unusedSelectedCollectionIds.length > 0 ? (
            <p className="mt-1 font-mono text-zinc-500">
              unused selected: {sourceSelection.unusedSelectedCollectionIds.map(shortId).join(", ")}
            </p>
          ) : null}
          {sourceSelection.suggestedCollections.length > 0 ? (
            <div className="mt-1">
              <p className="text-zinc-300">Suggested</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {sourceSelection.suggestedCollections.map((collection) => (
                  <li key={collection.id}>
                    {collection.name} · <span className="font-mono text-zinc-500">{shortId(collection.id)}</span>
                    <span className="block text-zinc-500">{collection.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sourceSelection.metadataRouteCandidates && sourceSelection.metadataRouteCandidates.length > 0 ? (
            <div className="mt-2">
              <p className="text-zinc-300">Metadata route candidates</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {sourceSelection.metadataRouteCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    {candidate.name} · score {candidate.score}
                    <span className="block text-zinc-500">
                      {candidate.domain ?? "-"} / {candidate.subtopics.join(", ") || "-"} · {candidate.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {redFlags.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium text-zinc-300">Red flags</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {redFlags.slice(0, 3).map((item, index) => (
              <li key={`red-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {uncertain.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium text-zinc-300">Belirsiz / kullanılmayan</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {uncertain.slice(0, 3).map((item, index) => (
              <li key={`uncertain-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {debug.queryPlan?.searchQueries?.length ? (
        <p className="mt-2 font-mono text-zinc-500">
          query: {debug.queryPlan.searchQueries.slice(0, 2).join(" | ")}
        </p>
      ) : null}
    </details>
  );
}

function DomainBadge({ debug }: { debug?: ChatRetrievalDebug }) {
  if (!debug) return null;
  return (
    <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-500">
      Domain: {debug.domain} · Grounding: {debug.groundingConfidence}
    </p>
  );
}

function SourceSelectionActionBadge({
  debug,
  onSelectCollection,
}: {
  debug?: ChatRetrievalDebug;
  onSelectCollection: (collectionId: string) => void;
}) {
  const selection = debug?.sourceSelection;
  if (!selection) return null;
  const isHealthy = selection.hasSources && !selection.warning;
  const actionSuggestions = [
    ...(selection.metadataRouteCandidates ?? []).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      reason: candidate.reason,
      score: candidate.score,
      source: "metadata" as const,
    })),
    ...selection.suggestedCollections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      reason: collection.reason,
      score: 0,
      source: "retrieval" as const,
    })),
  ].filter((suggestion, index, arr) => arr.findIndex((item) => item.id === suggestion.id) === index).slice(0, 3);
  if (isHealthy && actionSuggestions.length === 0) return null;

  const label = isHealthy
    ? "Kaynak uygun"
    : selection.hasSources
      ? "Kaynak temkinli"
      : "Kaynak bulunamadı";
  const emptySourceMessage = !selection.hasSources
    ? "Seçili veya erişilebilir kaynaklar bu soruyu yeterince desteklemedi. Uygun öneriye tıklayıp aynı soruyu tekrar gönderebilirsiniz."
    : null;
  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${
        isHealthy
          ? "border-emerald-500/20 bg-emerald-950/10 text-emerald-100/90"
          : selection.hasSources
            ? "border-amber-500/20 bg-amber-950/10 text-amber-100/90"
            : "border-zinc-700 bg-zinc-950/70 text-zinc-400"
      }`}
    >
      <span className="font-medium">{label}</span>
      {!isHealthy ? (
        <span className="ml-2 text-zinc-500">
          {selection.usedCollectionIds.length} / {selection.accessibleCollectionIds.length} collection
        </span>
      ) : null}
      {selection.warning ? (
        <p className="mt-1">{selection.warning}</p>
      ) : null}
      {emptySourceMessage ? (
        <p className="mt-1 text-zinc-300">{emptySourceMessage}</p>
      ) : null}
      {actionSuggestions.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium">Daha uygun kaynak önerisi</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {actionSuggestions.map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => onSelectCollection(collection.id)}
                className="rounded-full border border-zinc-700 bg-zinc-950/70 px-2.5 py-1 text-left text-[10px] text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-100"
                title={collection.reason}
              >
                {collection.name}
                {collection.source === "metadata" ? (
                  <span className="ml-1 text-zinc-500">score {collection.score}</span>
                ) : null}
                <span className="ml-1 font-mono text-zinc-500">({shortId(collection.id)})</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-zinc-500">
            Öneriye tıklayınca chat bu kaynakla sınırlandırılır; ardından aynı soruyu yeniden gönderin.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ChatScreen() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const params = useSearchParams();
  const adapterFromQuery = params.get("adapter") ?? "";
  const cidFromQuery = params.get("cid") ?? "";

  const [adapterId, setAdapterId] = useState(adapterFromQuery);
  const [adapterCid, setAdapterCid] = useState(cidFromQuery);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adapterDevTest, setAdapterDevTest] = useState(false);
  const [adapterRuntimeWarning, setAdapterRuntimeWarning] = useState<string | null>(null);
  const [collections, setCollections] = useState<KnowledgeCollectionListItem[]>([]);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [includePublic, setIncludePublic] = useState(false);
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeDomainFilter, setKnowledgeDomainFilter] = useState<KnowledgeDomainFilter>("auto");
  const [showInternalKnowledge, setShowInternalKnowledge] = useState(false);
  const [showDebugDetails, setShowDebugDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setAdapterId(adapterFromQuery);
  }, [adapterFromQuery]);

  useEffect(() => {
    setAdapterCid(cidFromQuery);
  }, [cidFromQuery]);

  useEffect(() => {
    const id = adapterId.trim();
    if (!id) {
      setAdapterDevTest(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const metadata = await fetchAdapterChatMetadata(id);
      if (cancelled) return;
      const isUnsupportedLocalPeft =
        metadata?.runtime === "TRANSFORMERS" && metadata?.format === "PEFT";
      if (isUnsupportedLocalPeft) {
        setAdapterRuntimeWarning(
          "Bu PEFT LoRA yerel llama_cpp chat'te devre dışı bırakıldı; şu an RAG-only çalışıyor.",
        );
        setAdapterId("");
        setAdapterDevTest(false);
        return;
      }
      setAdapterRuntimeWarning(null);
      setAdapterDevTest(isDevTestAdapter({ id, domainTags: metadata?.domainTags ?? [] }));
    })();
    return () => {
      cancelled = true;
    };
  }, [adapterId]);

  useEffect(() => {
    if (!account?.address) {
      setCollections([]);
      setSelectedCollectionIds([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const auth = await ensureAuthHeaders();
        const rows = await fetchKnowledgeCollections(auth, "all");
        if (cancelled) return;
        setCollections(rows);
        setCollectionsError(null);
      } catch (e) {
        if (cancelled) return;
        setCollections([]);
        setCollectionsError(
          isLikelyWalletAuthFailure(e)
            ? userFacingWalletAuthError(e)
            : chat.knowledgeSectionHint,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.address, ensureAuthHeaders]);

  useEffect(() => {
    setSelectedCollectionIds((current) => {
      const availableIds = new Set(collections.map((collection) => collection.id));
      const stillAvailable = current.filter((id) => availableIds.has(id));
      if (stillAvailable.length > 0) {
        return stillAvailable.length === current.length ? current : stillAvailable;
      }
      if (collections.length === 1) {
        return [collections[0].id];
      }
      return stillAvailable;
    });
  }, [collections]);

  function toggleCollection(id: string) {
    setSelectedCollectionIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function selectSuggestedCollection(id: string) {
    setSelectedCollectionIds([id]);
    setIncludePublic(false);
    setShowInternalKnowledge((current) => {
      const collection = collections.find((item) => item.id === id);
      return collection && isInternalKnowledgeCollection(collection) ? true : current;
    });
  }

  function useSuggestedPrompt(prompt: string) {
    setInput(prompt);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    if (!account?.address) {
      setError(walletConnectForChatAction);
      return;
    }

    const priorMessages = messages;
    const userMsg: ChatTurn = { role: "user", content: text };
    const history = [...priorMessages, userMsg];
    setInput("");
    setStreaming(true);
    setError(null);
    setMessages([...history, { role: "assistant", content: "", sources: [] }]);

    const ac = new AbortController();
    abortRef.current = ac;

    let assistant = "";
    let auth: R3mesWalletAuthHeaders;
    try {
      auth = await ensureAuthHeaders();
    } catch (e) {
      setMessages(priorMessages);
      setInput(text);
      setError(userFacingWalletAuthError(e));
      abortRef.current = null;
      setStreaming(false);
      return;
    }

    try {
      for await (const piece of streamChatCompletions({
        messages: history,
        adapterId: adapterRuntimeWarning ? undefined : adapterId.trim() || undefined,
        adapterCid: adapterCid.trim() || undefined,
        collectionIds: selectedCollectionIds,
        includePublic,
        auth,
        signal: ac.signal,
        onSources: (sources) => {
          setMessages([
            ...history,
            {
              role: "assistant",
              content: assistant,
              sources,
            },
          ]);
        },
        onRetrievalDebug: (retrievalDebug) => {
          setMessages((current) => {
            const last = current[current.length - 1];
            const sources = last?.role === "assistant" ? last.sources : [];
            return [
              ...history,
              {
                role: "assistant",
                content: assistant,
                sources,
                retrievalDebug,
              },
            ];
          });
        },
      })) {
        assistant = sanitizeAssistantText(assistant + piece);
        setMessages((current) => {
          const last = current[current.length - 1];
          const sources = last?.role === "assistant" ? last.sources : [];
          const retrievalDebug = last?.role === "assistant" ? last.retrievalDebug : undefined;
          return [
            ...history,
            { role: "assistant", content: assistant, sources, retrievalDebug },
          ];
        });
      }
    } catch (e) {
      const aborted =
        e instanceof DOMException
          ? e.name === "AbortError"
          : e instanceof Error && e.name === "AbortError";
      if (aborted) {
        setError(null);
        if (assistant.length > 0) {
          setMessages((current) => {
            const last = current[current.length - 1];
            const sources = last?.role === "assistant" ? last.sources : [];
            return [
              ...history,
              { role: "assistant", content: assistant, sources },
            ];
          });
        } else {
          setMessages(history);
        }
      } else if (isLikelyWalletAuthFailure(e)) {
        setMessages(priorMessages);
        setInput(text);
        setError(userFacingWalletAuthError(e));
      } else {
        const raw = e instanceof Error ? e.message : "";
        const networkish =
          raw === "Failed to fetch" ||
          raw.startsWith("NetworkError") ||
          raw.includes("fetch resource");
        const main = networkish
          ? chat.networkError
          : raw.trim() || chat.streamFallback;
        setError(`${main} ${chat.errorHint}`);
        setMessages(history);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const canSend = Boolean(account?.address) && input.trim().length > 0 && !streaming;
  const hasAdapterContext =
    adapterId.trim().length > 0 || adapterCid.trim().length > 0;
  const searchTerm = knowledgeSearch.trim().toLocaleLowerCase("tr-TR");
  const autoDomain = inferKnowledgeDomain(`${input} ${knowledgeSearch}`);
  const activeDomain =
    knowledgeDomainFilter === "auto" ? autoDomain : knowledgeDomainFilter;
  const selectedCollections = collections.filter((collection) =>
    selectedCollectionIds.includes(collection.id),
  );
  const hiddenInternalCount = collections.filter(isInternalKnowledgeCollection).length;
  const visibleCollections = collections
    .filter((collection) => showInternalKnowledge || !isInternalKnowledgeCollection(collection))
    .filter((collection) => {
      if (!activeDomain || activeDomain === "all") return true;
      return collectionDomain(collection) === activeDomain;
    })
    .filter((collection) => searchMatchesCollection(collection, searchTerm));
  const recommendedCollections = rankRecommendedCollections(
    visibleCollections,
    selectedCollectionIds,
    activeDomain && activeDomain !== "all" ? activeDomain : null,
  );
  const visibleGroups = groupKnowledgeCollections(visibleCollections, selectedCollectionIds);
  const activeDomainLabel =
    activeDomain && activeDomain !== "all" ? KNOWLEDGE_DOMAIN_LABELS[activeDomain] : null;
  const latestAssistantWithSourceSelection = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.retrievalDebug?.sourceSelection);
  const latestSourceSelection = latestAssistantWithSourceSelection?.retrievalDebug?.sourceSelection;
  const latestBackendSuggestions = latestSourceSelection?.suggestedCollections ?? [];
  const latestMetadataCandidates = latestSourceSelection?.metadataRouteCandidates ?? [];
  const backendSuggestedCollections = [
    ...latestMetadataCandidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      reason: candidate.reason,
      score: candidate.score,
      source: "metadata" as const,
    })),
    ...latestBackendSuggestions.map((suggestion) => ({
      id: suggestion.id,
      name: suggestion.name,
      reason: suggestion.reason,
      score: 0,
      source: "retrieval" as const,
    })),
  ]
    .filter((suggestion, index, arr) => arr.findIndex((item) => item.id === suggestion.id) === index)
    .map((suggestion) => ({
      suggestion,
      collection: collections.find((collection) => collection.id === suggestion.id),
    }))
    .filter((item): item is {
      suggestion: { id: string; name: string; reason: string; score: number; source: "metadata" | "retrieval" };
      collection: KnowledgeCollectionListItem;
    } => Boolean(item.collection))
    .slice(0, 3);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4 sm:gap-6">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-4"
      >
        <div className="rounded-xl border border-r3mes-border bg-r3mes-surface/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                {chat.knowledgeSectionTitle}
              </p>
              <p className="text-sm leading-relaxed text-zinc-400">
                {chat.knowledgeSectionHint}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={includePublic}
                onChange={(e) => setIncludePublic(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-cyan-500/40"
              />
              Public havuzu da kullan
            </label>
          </div>
          {selectedCollectionIds.length > 0 && includePublic ? (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Not: Collection seçiliyse sorgu seçili kaynaklarla sınırlı kalır; public havuz tümüyle yalnız seçim yokken devreye girer.
            </p>
          ) : null}

          {collectionsError ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-200/90">
              {collectionsError}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100">
              Auto source aktif
            </span>
            {selectedCollectionIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelectedCollectionIds([])}
                className="rounded-full border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                Seçimi temizle
              </button>
            ) : null}
          </div>

          <details className="mt-3 rounded-xl border border-zinc-800/80 bg-black/10 p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Kaynakları elle yönet
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {KNOWLEDGE_DOMAIN_FILTERS.map((filter) => {
                  const active = knowledgeDomainFilter === filter.id;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setKnowledgeDomainFilter(filter.id)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                        active
                          ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-100"
                          : "border-zinc-800 bg-zinc-950/60 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {filter.label}
                      {filter.id === "auto" && autoDomain ? `: ${autoDomain}` : ""}
                    </button>
                  );
                })}
              </div>
              <input
                value={knowledgeSearch}
                onChange={(e) => setKnowledgeSearch(e.target.value)}
                placeholder="Kaynak ara…"
                className="min-h-[36px] min-w-[220px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/40 focus:outline-none"
              />
              {hiddenInternalCount > 0 ? (
                <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={showInternalKnowledge}
                    onChange={(e) => setShowInternalKnowledge(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-cyan-500/40"
                  />
                  Test/demo kaynakları göster ({hiddenInternalCount})
                </label>
              ) : null}
              {CHAT_DEBUG_ENABLED ? (
                <label className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
                  <input
                    type="checkbox"
                    checked={showDebugDetails}
                    onChange={(e) => setShowDebugDetails(e.target.checked)}
                    className="rounded border-amber-700 bg-zinc-950 text-amber-500 focus:ring-amber-500/40"
                  />
                  Debug göster
                </label>
              ) : null}
            </div>
          </details>

          {selectedCollections.length > 0 ? (
            <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 px-3 py-2 text-xs leading-relaxed text-emerald-100/90">
              <span className="font-medium">Sadece seçili private/public kaynaklar: </span>
              <span className="inline-flex flex-wrap gap-1.5 align-middle">
                {selectedCollections.map((collection) => (
                  <span key={collection.id} className="inline-flex items-center gap-1">
                    <span>{collection.name}</span>
                    <VisibilityPill visibility={collection.visibility} />
                  </span>
                ))}
              </span>
            </div>
          ) : includePublic ? (
            <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-950/10 px-3 py-2 text-xs leading-relaxed text-sky-100/90">
              Seçili private kaynak yok. Bu cevapta erişilebilir public knowledge havuzu kullanılabilir.
            </div>
          ) : activeDomainLabel ? (
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs leading-relaxed text-zinc-400">
              Kaynak önerileri şu domain'e daraltıldı: <span className="font-medium text-zinc-200">{activeDomainLabel}</span>. Uygun kaynak yoksa "Tümü" filtresine geçin.
            </div>
          ) : null}

          {collections.length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              {chat.noKnowledgeSelected}
            </p>
          ) : visibleCollections.length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Filtreye uyan knowledge kaynağı yok.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {backendSuggestedCollections.length > 0 ? (
                <section className="rounded-xl border border-sky-500/25 bg-sky-950/15 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-sky-100">
                        Akıllı kaynak önerisi
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-sky-100/70">
                        Son sorunun metadata profili ve retrieval sinyaline göre en uygun görünen kısa liste.
                      </p>
                    </div>
                    <span className="rounded-full bg-sky-950 px-2 py-0.5 text-[10px] text-sky-100/80">
                      {backendSuggestedCollections.length} kaynak
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {backendSuggestedCollections.map(({ suggestion, collection }) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => selectSuggestedCollection(suggestion.id)}
                        className="rounded-xl border border-sky-500/25 bg-zinc-950/60 px-3 py-2 text-left text-xs text-sky-50 hover:border-sky-400/50"
                        title={suggestion.reason}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{collection.name}</span>
                          <VisibilityPill visibility={collection.visibility} />
                          <span className="rounded-full border border-sky-500/25 px-1.5 py-0.5 text-[10px] text-sky-100/70">
                            {suggestion.source === "metadata" ? `metadata ${suggestion.score}` : "retrieval"}
                          </span>
                        </span>
                        <span className="mt-1 block max-w-xl text-[11px] leading-relaxed text-sky-100/65">
                          {suggestion.reason}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {backendSuggestedCollections.length === 0 ? (
              <details className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-emerald-100">
                  Elle kaynak önerilerini göster ({recommendedCollections.length})
                </summary>
                <div className="mt-3">
                  <p className="text-[11px] leading-relaxed text-emerald-100/70">
                    Bu kısa liste lokal metadata ile hazırlanır. Ana karar backend auto source hattındadır.
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {recommendedCollections.map((collection) => {
                      const checked = selectedCollectionIds.includes(collection.id);
                      const domain = collectionDomain(collection);
                      const quality = profileQualityLabel(collection);
                      return (
                        <li key={collection.id}>
                          <button
                            type="button"
                            onClick={() => selectSuggestedCollection(collection.id)}
                            className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${
                              checked
                                ? "border-emerald-500/50 bg-emerald-950/25 text-emerald-50"
                                : "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-emerald-500/35 hover:text-zinc-100"
                            }`}
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{collection.name}</span>
                              <VisibilityPill visibility={collection.visibility} />
                            </span>
                            <span className="mt-1 block text-[11px] text-zinc-500">
                              {collection.documentCount} doküman · {formatCollectionDate(collection.updatedAt)}
                              {domain ? ` · ${KNOWLEDGE_DOMAIN_LABELS[domain]}` : ""}
                              {quality ? ` · ${quality}` : ""}
                            </span>
                            {collection.inferredTopic || collection.inferredTags?.length ? (
                              <span className="mt-1 block text-[10px] text-zinc-500">
                                {collection.inferredTopic ?? collection.inferredTags?.slice(0, 2).join(", ")}
                              </span>
                            ) : null}
                            <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                              {shortId(collection.id)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[11px] leading-relaxed text-emerald-100/65">
                    Bir öneriye tıklamak chat'i yalnız o kaynakla sınırlar.
                  </p>
                </div>
              </details>
              ) : null}

              <details className="rounded-xl border border-zinc-800/80 bg-black/10 p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Tüm kaynakları göster ({visibleCollections.length})
                </summary>
                <div className="mt-3 space-y-4">
                  {visibleGroups.map((group) => (
                    <section key={group.id} className="rounded-xl border border-zinc-800/80 bg-black/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                            {group.title}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                            {group.hint}
                          </p>
                        </div>
                        <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">
                          {group.items.length} kaynak
                        </span>
                      </div>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {group.items.map((collection) => {
                          const checked = selectedCollectionIds.includes(collection.id);
                          const domain = collectionDomain(collection);
                          const quality = profileQualityLabel(collection);
                          return (
                            <li key={collection.id}>
                              <label
                                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm text-zinc-300 ${
                                  checked
                                    ? "border-emerald-500/40 bg-emerald-950/10"
                                    : "border-zinc-800 bg-zinc-950/40"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleCollection(collection.id)}
                                  className="mt-0.5 rounded border-zinc-700 bg-zinc-950 text-cyan-500 focus:ring-cyan-500/40"
                                />
                                <span className="min-w-0">
                                  <span className="block font-medium text-zinc-100">
                                    {collection.name}
                                  </span>
                                  <span className="mt-1 block text-[11px] text-zinc-500">
                                    {collection.documentCount} doküman · {formatCollectionDate(collection.updatedAt)}
                                    {domain ? ` · ${KNOWLEDGE_DOMAIN_LABELS[domain]}` : ""}
                                    {quality ? ` · ${quality}` : ""}
                                  </span>
                                  {collection.inferredTopic || collection.inferredTags?.length ? (
                                    <span className="mt-1 block text-[10px] text-zinc-500">
                                      {collection.inferredTopic ?? collection.inferredTags?.slice(0, 2).join(", ")}
                                    </span>
                                  ) : null}
                                  <span className="mt-1 block">
                                    <VisibilityPill visibility={collection.visibility} />
                                  </span>
                                  <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                                    {shortId(collection.id)}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        <details className="rounded-xl border border-zinc-800/80 bg-r3mes-surface/25 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Behavior skill / LoRA opsiyonel
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase text-zinc-500">
                Behavior LoRA kimliği
              </label>
              <input
                value={adapterId}
                onChange={(e) => setAdapterId(e.target.value)}
                placeholder="Behavior library'den seçildiğinde dolar"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs uppercase text-zinc-500">
                Behavior LoRA IPFS adresi
              </label>
              <input
                value={adapterCid}
                onChange={(e) => setAdapterCid(e.target.value)}
                placeholder="bafy…"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-cyan-500/40 focus:outline-none"
              />
            </div>
          </div>
        </details>

        {adapterDevTest && hasAdapterContext ? (
          <div className="flex flex-wrap items-center gap-2">
            <DevTestPill />
            <span className="text-[11px] leading-relaxed text-zinc-500">
              {chat.devTestAdapterHint}
            </span>
          </div>
        ) : null}

        {adapterRuntimeWarning ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-100">
            {adapterRuntimeWarning}
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-zinc-500">
          {chat.adapterOnlyNote}
        </p>

        {!hasAdapterContext ? (
          <p className="rounded-lg border border-cyan-500/20 bg-cyan-950/10 px-3 py-2 text-xs leading-relaxed text-zinc-300">
            <span>{chat.adapterMissingLead} </span>
            <Link
              href="/"
              className="font-medium text-cyan-300 underline-offset-2 hover:underline"
            >
              {chat.marketplaceLinkLabel}
            </Link>
            <span> {chat.adapterMissingTail}</span>
          </p>
        ) : null}
      </motion.header>

      <div className="flex min-h-[420px] flex-1 flex-col rounded-2xl border border-zinc-800 bg-zinc-950/50">
        <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          {messages.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950/80 to-cyan-950/10 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
                Auto source chat
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
                Kaynağı sistem seçsin, sen soruya odaklan.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
                {hasAdapterContext ? chat.emptyThread : chat.emptyThreadNoAdapter}
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => useSuggestedPrompt(prompt)}
                    className="rounded-2xl border border-zinc-800 bg-black/20 px-3 py-3 text-left text-sm leading-relaxed text-zinc-300 transition hover:border-cyan-400/35 hover:bg-cyan-400/[0.06] hover:text-cyan-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <motion.div
              key={`msg-${i}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-2 text-sm leading-relaxed sm:max-w-[85%] ${
                  m.role === "user"
                    ? "bg-cyan-600/90 text-white"
                    : "border border-zinc-800 bg-zinc-900/80 text-zinc-100"
                }`}
              >
                <span className="mb-1 block text-[10px] uppercase opacity-60">
                  {m.role === "user"
                    ? chat.roleUser
                    : m.role === "assistant"
                      ? chat.roleAssistant
                      : m.role}
                </span>
                {m.role === "assistant" && m.content === "" && streaming ? (
                  <span className="animate-pulse text-zinc-500">
                    {chat.preparingReply}
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
                {m.role === "assistant" ? (
                  <SourceSelectionActionBadge
                    debug={m.retrievalDebug}
                    onSelectCollection={selectSuggestedCollection}
                  />
                ) : null}
                {m.role === "assistant" ? <SourceList sources={m.sources} collections={collections} /> : null}
                {m.role === "assistant" && showDebugDetails ? <DomainBadge debug={m.retrievalDebug} /> : null}
                {m.role === "assistant" ? (
                  <RetrievalDebugPanel
                    debug={m.retrievalDebug}
                    visible={showDebugDetails}
                  />
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>

        {error ? (
          <p
            role="alert"
            className="border-t border-red-900/50 bg-red-950/40 px-4 py-3 text-sm leading-relaxed text-red-100"
          >
            {error}
          </p>
        ) : null}

        <div className="border-t border-zinc-800 p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Mesajınızı yazın…"
              disabled={streaming}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/40 focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void send()}
              className="min-h-[44px] rounded-xl bg-cyan-600 px-5 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Gönder
            </button>
            <button
              type="button"
              disabled={!streaming}
              onClick={stopStreaming}
              className="min-h-[44px] rounded-xl border border-red-500/50 bg-red-950/40 px-4 text-sm font-medium text-red-100 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sohbeti Durdur
            </button>
          </div>
          {!account?.address ? (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              {walletConnectForChatAction}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
