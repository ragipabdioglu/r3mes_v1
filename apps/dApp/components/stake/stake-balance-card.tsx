"use client";

import { motion } from "framer-motion";

import type { StakeSummary } from "@/lib/api/stake-api";
import { journey, loadingLabel } from "@/lib/ui/product-copy";

type Props = {
  loading: boolean;
  summary: StakeSummary | null;
  error: string | null;
};

export function StakeBalanceCard({ loading, summary, error }: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/50 to-r3mes-surface/80 p-6 shadow-lg shadow-black/20"
      aria-busy={loading}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-emerald-400/90">
        Stake özeti
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        Zincirden okunan toplam stake (nano birimi).
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-zinc-500">{loadingLabel}</p>
      ) : error ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-amber-200/90">{error}</p>
          <p className="text-xs text-zinc-500">{journey.refreshPage}</p>
        </div>
      ) : (
        <p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-white break-all">
          {summary?.totalStakedNano ?? "0"}
          <span className="ml-2 block text-sm font-normal text-zinc-400">
            Toplam (nano birimi)
          </span>
        </p>
      )}
      {summary && summary.positions.length > 0 ? (
        <p className="mt-2 text-xs text-zinc-500">
          {summary.positions.length} açık pozisyon
        </p>
      ) : null}
    </motion.div>
  );
}
