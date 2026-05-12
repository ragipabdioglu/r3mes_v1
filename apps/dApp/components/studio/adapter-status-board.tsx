"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { DevTestPill } from "@/components/dev-test-pill";
import { fetchMyAdapters } from "@/lib/api/adapters-trainer";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import { isDevTestAdapter } from "@/lib/types/adapter-dev-test";
import { userFacingFetchFailure } from "@/lib/ui/http-messages";
import {
  backendUrlHint,
  journey,
  knowledgeStudio,
  loadingLabel,
  walletConnectForStudio,
} from "@/lib/ui/product-copy";
import {
  isLikelyWalletAuthFailure,
  userFacingWalletAuthError,
} from "@/lib/ui/wallet-auth-user-message";
import {
  getAdapterStatusKind,
  statusBadgeLabel,
  type AdapterStatusKind,
} from "@/lib/types/adapter-status";
import type { AdapterListItem } from "@/lib/types/adapter";

function Badge({ kind }: { kind: AdapterStatusKind }) {
  const styles: Record<AdapterStatusKind, string> = {
    pending: "bg-amber-500/20 text-amber-200 ring-amber-500/40",
    active: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
    rejected: "bg-red-500/20 text-red-200 ring-red-500/40",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${styles[kind]}`}
    >
      {statusBadgeLabel(kind)}
    </span>
  );
}

export function AdapterStatusBoard() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AdapterListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
      const rows = await fetchMyAdapters(auth);
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
    const onUploaded = () => void load();
    window.addEventListener("r3mes-studio-adapters-changed", onUploaded);
    return () =>
      window.removeEventListener("r3mes-studio-adapters-changed", onUploaded);
  }, [load]);

  /** QA sonrası rozetin kullanıcıya otomatik düşmesi için (sayfa yenilemeden). */
  useEffect(() => {
    if (!account?.address) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [account?.address, load]);

  if (!account?.address) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-500">
        {walletConnectForStudio}
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          {knowledgeStudio.behaviorListTitle}
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-violet-400 hover:text-violet-300"
        >
          Yenile
        </button>
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
          Bu cüzdan için kayıtlı behavior LoRA yok. {journey.modelUploadEntry}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => {
            const kind = getAdapterStatusKind(a.status);
            const dev = isDevTestAdapter(a);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-r3mes-border bg-r3mes-surface/50 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-zinc-100">
                      {a.name}
                    </p>
                    {dev ? <DevTestPill /> : null}
                  </div>
                  <p className="truncate font-mono text-[11px] text-zinc-500">
                    {a.id}
                  </p>
                </div>
                <Badge kind={kind} />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-zinc-600">
        Rozetler: incelemede (sarı), yayında (yeşil), reddedildi veya kullanım
        dışı (kırmızı). Bu alan yalnız stil/persona LoRA kayıtlarını gösterir;
        knowledge doğruluğu RAG kaynakları ve feedback hattıyla yönetilir.
      </p>
    </motion.section>
  );
}
