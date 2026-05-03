"use client";

import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import { motion } from "framer-motion";

import { getR3mesCoinType } from "@/lib/env";
import { loadingLabel, walletBalance } from "@/lib/ui/product-copy";

function formatRawAmount(raw: string | undefined, decimals: number) {
  if (raw === undefined) return "—";
  const n = BigInt(raw);
  if (decimals <= 0) return n.toString();
  const div = BigInt(10) ** BigInt(decimals);
  const whole = n / div;
  const frac = n % div;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fracStr.length ? `${whole}.${fracStr}` : whole.toString();
}

export function R3mesBalanceCard() {
  const account = useCurrentAccount();
  const coinType = getR3mesCoinType();
  const address = account?.address;

  const balanceQuery = useSuiClientQuery(
    "getBalance",
    {
      owner: address ?? "",
      coinType,
    },
    { enabled: Boolean(address) },
  );

  const metaQuery = useSuiClientQuery(
    "getCoinMetadata",
    { coinType },
    {
      enabled: Boolean(address),
    },
  );

  if (!address) {
    return (
      <motion.div
        layout
        className="rounded-2xl border border-r3mes-border bg-r3mes-surface/60 p-6 shadow-xl shadow-black/20"
      >
        <p className="text-sm text-zinc-400">{walletBalance.connectPrompt}</p>
      </motion.div>
    );
  }

  const decimals = metaQuery.data?.decimals ?? 9;
  const raw = balanceQuery.data?.totalBalance;
  const symbol = metaQuery.data?.symbol ?? "R3MES";

  return (
    <motion.div
      layout
      className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 to-r3mes-surface/80 p-6 shadow-xl shadow-cyan-950/20"
    >
      <p className="text-xs uppercase tracking-wider text-cyan-200/80">
        {symbol} (zincir)
      </p>
      <p
        className={`mt-2 tracking-tight text-white ${
          balanceQuery.isPending ? "text-lg text-zinc-500" : "font-mono text-3xl font-semibold"
        }`}
      >
        {balanceQuery.isPending
          ? loadingLabel
          : balanceQuery.isError
            ? "—"
            : formatRawAmount(raw, decimals)}
      </p>
      <p className="mt-2 truncate font-mono text-[10px] text-zinc-500">
        {coinType}
      </p>
      {balanceQuery.isError ? (
        <p className="mt-2 text-xs text-red-400">{walletBalance.loadError}</p>
      ) : null}
    </motion.div>
  );
}
