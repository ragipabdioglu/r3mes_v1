"use client";

import { motion } from "framer-motion";

import type { UserRewardsPayload } from "@/lib/api/stake-api";
import { journey, loadingLabel } from "@/lib/ui/product-copy";

type Props = {
  loading: boolean;
  rewards: UserRewardsPayload | null;
  error: string | null;
  claimBusy: boolean;
  onClaim: () => Promise<void>;
};

export function RewardsPanel({
  loading,
  rewards,
  error,
  claimBusy,
  onClaim,
}: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-950/40 to-r3mes-surface/80 p-6 shadow-lg shadow-black/20"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-200/80">
            Ödül özeti
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-600">
            Rakamlar zincir özetinden okunur.
          </p>
          {loading ? (
            <p className="mt-2 text-sm text-zinc-500">{loadingLabel}</p>
          ) : error ? (
            <div className="mt-2 space-y-2">
              <p className="text-sm text-amber-200/90">{error}</p>
              <p className="text-xs text-zinc-500">{journey.refreshPage}</p>
            </div>
          ) : rewards ? (
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500" title="stakeWithdrawnBaseUnits">
                  Stake’ten çekilen (birim)
                </dt>
                <dd className="font-mono text-zinc-200">
                  {rewards.stakeWithdrawnBaseUnits}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500" title="stakeSlashedBaseUnits">
                  Kesinti (slash)
                </dt>
                <dd className="font-mono text-zinc-200">
                  {rewards.stakeSlashedBaseUnits}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500" title="chatUsageFeesPaidMist">
                  Sohbet ücreti (MIST)
                </dt>
                <dd className="font-mono text-zinc-200">
                  {rewards.chatUsageFeesPaidMist}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-500" title="eventPagesScanned">
                  Taranan olay sayfası
                </dt>
                <dd className="font-mono text-zinc-200">
                  {rewards.eventPagesScanned}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              Bu adres için görüntülenecek özet yok.
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Ödül talebi — zincir üzerinden tamamlanır"
          disabled={claimBusy || loading || Boolean(error)}
          onClick={() => void onClaim()}
          className="shrink-0 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {claimBusy ? loadingLabel : "Ödül talebi"}
        </button>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
        {journey.rewardsOnChain} Bu düğüm yalnızca deneme isteği gönderir.
      </p>
    </motion.div>
  );
}
