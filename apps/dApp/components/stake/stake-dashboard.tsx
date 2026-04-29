"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";

import {
  fetchStakeSummary,
  fetchUserRewards,
  postClaimRewards,
  postStakeIntent,
  type StakeSummary,
  type UserRewardsPayload,
} from "@/lib/api/stake-api";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import {
  isNotImplementedResponse,
  userFacingFetchFailure,
  userFacingHttpMessage,
  userFacingMutationFailure,
} from "@/lib/ui/http-messages";
import { mutationCompleted, walletConnectForStake } from "@/lib/ui/product-copy";
import { userFacingWalletAuthError } from "@/lib/ui/wallet-auth-user-message";

type Feedback =
  | { message: string; variant: "success" | "warning" | "error" }
  | null;

import { RewardsPanel } from "./rewards-panel";
import { StakeBalanceCard } from "./stake-balance-card";
import { StakeForm } from "./stake-form";

export function StakeDashboard() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const addr = account?.address;

  const [stakeLoading, setStakeLoading] = useState(false);
  const [stakeSummary, setStakeSummary] = useState<StakeSummary | null>(null);
  const [stakeErr, setStakeErr] = useState<string | null>(null);

  const [rewLoading, setRewLoading] = useState(false);
  const [rewards, setRewards] = useState<UserRewardsPayload | null>(null);
  const [rewErr, setRewErr] = useState<string | null>(null);

  const [stakeBusy, setStakeBusy] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const refresh = useCallback(async () => {
    if (!addr) {
      setStakeSummary(null);
      setRewards(null);
      setStakeErr(null);
      setRewErr(null);
      return;
    }
    setStakeLoading(true);
    setRewLoading(true);
    setStakeErr(null);
    setRewErr(null);
    try {
      const s = await fetchStakeSummary(addr);
      setStakeSummary(s);
      if (!s) {
        setStakeErr(userFacingFetchFailure("stake"));
      }
    } catch {
      setStakeErr(userFacingFetchFailure("stake"));
    } finally {
      setStakeLoading(false);
    }
    try {
      const r = await fetchUserRewards(addr);
      setRewards(r);
      if (!r) {
        setRewErr(userFacingFetchFailure("rewards"));
      }
    } catch {
      setRewErr(userFacingFetchFailure("rewards"));
    } finally {
      setRewLoading(false);
    }
  }, [addr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleStake(amount: string) {
    if (!addr) return;
    setStakeBusy(true);
    setFeedback(null);
    let auth: R3mesWalletAuthHeaders;
    try {
      auth = await ensureAuthHeaders();
    } catch (e) {
      setFeedback({
        message: userFacingWalletAuthError(e),
        variant: "warning",
      });
      setStakeBusy(false);
      return;
    }
    try {
      const res = await postStakeIntent(amount, auth);
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        setFeedback({
          message: userFacingHttpMessage(res.status, text, "stake"),
          variant: isNotImplementedResponse(res.status, text)
            ? "warning"
            : "error",
        });
        return;
      }
      setFeedback({ message: mutationCompleted, variant: "success" });
      await refresh();
    } catch {
      setFeedback({
        message: userFacingMutationFailure("stake"),
        variant: "error",
      });
    } finally {
      setStakeBusy(false);
    }
  }

  async function handleClaim() {
    if (!addr) return;
    setClaimBusy(true);
    setFeedback(null);
    let auth: R3mesWalletAuthHeaders;
    try {
      auth = await ensureAuthHeaders();
    } catch (e) {
      setFeedback({
        message: userFacingWalletAuthError(e),
        variant: "warning",
      });
      setClaimBusy(false);
      return;
    }
    try {
      const res = await postClaimRewards(addr, auth);
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        setFeedback({
          message: userFacingHttpMessage(res.status, text, "stake"),
          variant: isNotImplementedResponse(res.status, text)
            ? "warning"
            : "error",
        });
        return;
      }
      setFeedback({ message: mutationCompleted, variant: "success" });
      await refresh();
    } catch {
      setFeedback({
        message: userFacingMutationFailure("claim"),
        variant: "error",
      });
    } finally {
      setClaimBusy(false);
    }
  }

  if (!addr) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-400">
        {walletConnectForStake}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <StakeBalanceCard
            loading={stakeLoading}
            summary={stakeSummary}
            error={stakeErr}
          />
        </div>
        <div className="lg:col-span-2">
          <StakeForm
            disabled={!addr}
            busy={stakeBusy}
            onStake={handleStake}
          />
        </div>
      </div>

      <RewardsPanel
        loading={rewLoading}
        rewards={rewards}
        error={rewErr}
        claimBusy={claimBusy}
        onClaim={handleClaim}
      />

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            feedback.variant === "success"
              ? "border-emerald-500/35 bg-emerald-950/30 text-emerald-50"
              : feedback.variant === "warning"
                ? "border-amber-500/40 bg-amber-950/30 text-amber-50"
                : "border-red-500/40 bg-red-950/35 text-red-50"
          }`}
        >
          <p className="min-w-0 flex-1 leading-relaxed">{feedback.message}</p>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 text-xs font-medium text-white/70 underline-offset-2 hover:text-white hover:underline"
          >
            Kapat
          </button>
        </div>
      ) : null}
    </div>
  );
}
