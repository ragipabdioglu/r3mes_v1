"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { journey, loadingLabel } from "@/lib/ui/product-copy";

type Props = {
  disabled: boolean;
  busy: boolean;
  onStake: (amount: string) => Promise<void>;
};

export function StakeForm({ disabled, busy, onStake }: Props) {
  const [amount, setAmount] = useState("");

  async function submit() {
    const t = amount.trim();
    if (!t || disabled || busy) return;
    await onStake(t);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-r3mes-border bg-r3mes-surface/60 p-6 shadow-lg shadow-black/15"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Stake et
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        {journey.stakeOnChain} Aşağıdaki düğüm deneme isteği içindir.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-xs text-zinc-500">Miktar</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            disabled={disabled || busy}
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 font-mono text-lg text-white placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
          />
        </div>
        <button
          type="button"
          disabled={disabled || busy || !amount.trim()}
          onClick={() => void submit()}
          className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? loadingLabel : "Stake gönder"}
        </button>
      </div>
    </motion.div>
  );
}
