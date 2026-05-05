"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";

import {
  createKnowledgeFeedbackApplyRecord,
  fetchKnowledgeFeedbackApplyPlan,
  fetchKnowledgeFeedbackApplyRecords,
  fetchKnowledgeFeedbackProposalImpact,
  fetchKnowledgeFeedbackProposals,
  fetchKnowledgeFeedbackSummary,
  generateKnowledgeFeedbackProposals,
  reviewKnowledgeFeedbackProposal,
  type KnowledgeFeedbackApplyRecordItem,
  type KnowledgeFeedbackApplyRecordListResponse,
  type KnowledgeFeedbackApplyPlanResponse,
  type KnowledgeFeedbackProposalImpactResponse,
  type KnowledgeFeedbackProposalItem,
  type KnowledgeFeedbackSummaryResponse,
} from "@/lib/api/feedback";
import { useR3mesWalletAuth } from "@/lib/hooks/use-r3mes-wallet-auth";
import { userFacingFetchFailure } from "@/lib/ui/http-messages";
import { walletConnectForStudio } from "@/lib/ui/product-copy";
import {
  isLikelyWalletAuthFailure,
  userFacingWalletAuthError,
} from "@/lib/ui/wallet-auth-user-message";

function shortId(value: string | null): string {
  if (!value) return "-";
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function actionLabel(action: KnowledgeFeedbackProposalItem["action"]): string {
  if (action === "BOOST_SOURCE") return "Kaynak boost";
  if (action === "PENALIZE_SOURCE") return "Kaynak ceza";
  if (action === "REVIEW_MISSING_SOURCE") return "Eksik kaynak incele";
  return "Cevap kalitesi incele";
}

function statusClass(status: KnowledgeFeedbackProposalItem["status"]): string {
  if (status === "APPROVED") return "border-emerald-500/25 bg-emerald-950/15 text-emerald-100";
  if (status === "REJECTED") return "border-zinc-700 bg-zinc-950/60 text-zinc-400";
  return "border-amber-500/25 bg-amber-950/15 text-amber-100";
}

function applyRecordStatusClass(status: KnowledgeFeedbackApplyRecordItem["status"]): string {
  if (status === "GATE_PASSED") return "border-emerald-500/25 bg-emerald-950/15 text-emerald-100";
  if (status === "BLOCKED") return "border-rose-500/25 bg-rose-950/15 text-rose-100";
  if (status === "APPLIED") return "border-cyan-500/25 bg-cyan-950/15 text-cyan-100";
  if (status === "ROLLED_BACK") return "border-zinc-700 bg-zinc-950/60 text-zinc-400";
  return "border-amber-500/25 bg-amber-950/15 text-amber-100";
}

function signalCount(item: KnowledgeFeedbackProposalItem): number {
  const keys = ["wrongSourceCount", "goodSourceCount", "missingSourceCount", "badAnswerCount"];
  return keys.reduce((sum, key) => {
    const value = item.evidence[key];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

export function FeedbackLearningBoard() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [summary, setSummary] = useState<KnowledgeFeedbackSummaryResponse | null>(null);
  const [proposals, setProposals] = useState<KnowledgeFeedbackProposalItem[]>([]);
  const [applyRecords, setApplyRecords] = useState<KnowledgeFeedbackApplyRecordListResponse | null>(null);
  const [impact, setImpact] = useState<Record<string, KnowledgeFeedbackProposalImpactResponse>>({});
  const [applyPlan, setApplyPlan] = useState<Record<string, KnowledgeFeedbackApplyPlanResponse>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account?.address) {
      setSummary(null);
      setProposals([]);
      setApplyRecords(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const [nextSummary, nextProposals, nextApplyRecords] = await Promise.all([
        fetchKnowledgeFeedbackSummary(auth),
        fetchKnowledgeFeedbackProposals(auth, "all"),
        fetchKnowledgeFeedbackApplyRecords(auth, "all"),
      ]);
      setSummary(nextSummary);
      setProposals(nextProposals);
      setApplyRecords(nextApplyRecords);
    } catch (e) {
      setErr(
        isLikelyWalletAuthFailure(e)
          ? userFacingWalletAuthError(e)
          : userFacingFetchFailure("studio"),
      );
    } finally {
      setLoading(false);
    }
  }, [account?.address, ensureAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setLoading(true);
    setErr(null);
    setMessage(null);
    try {
      const auth = await ensureAuthHeaders();
      const generated = await generateKnowledgeFeedbackProposals(auth);
      setMessage(`${generated.length} yeni proposal üretildi.`);
      await load();
    } catch (e) {
      setErr(
        isLikelyWalletAuthFailure(e)
          ? userFacingWalletAuthError(e)
          : "Proposal üretilemedi. Feedback sinyali henüz yeterli olmayabilir.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function showImpact(proposal: KnowledgeFeedbackProposalItem) {
    setBusyId(proposal.id);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const nextImpact = await fetchKnowledgeFeedbackProposalImpact(proposal.id, auth);
      setImpact((current) => ({ ...current, [proposal.id]: nextImpact }));
    } catch {
      setErr("Impact raporu alınamadı.");
    } finally {
      setBusyId(null);
    }
  }

  async function showApplyPlan(proposal: KnowledgeFeedbackProposalItem) {
    setBusyId(proposal.id);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const nextPlan = await fetchKnowledgeFeedbackApplyPlan(proposal.id, auth);
      setApplyPlan((current) => ({ ...current, [proposal.id]: nextPlan }));
    } catch {
      setErr("Apply plan alınamadı.");
    } finally {
      setBusyId(null);
    }
  }

  async function recordApplyPlan(proposal: KnowledgeFeedbackProposalItem) {
    setBusyId(proposal.id);
    setErr(null);
    setMessage(null);
    try {
      const auth = await ensureAuthHeaders();
      const created = await createKnowledgeFeedbackApplyRecord(proposal.id, auth);
      setMessage(`Apply record kaydedildi: ${shortId(created.record.id)}. Sıradaki güvenli adım eval gate.`);
      await load();
    } catch {
      setErr("Apply record kaydedilemedi.");
    } finally {
      setBusyId(null);
    }
  }

  async function review(proposal: KnowledgeFeedbackProposalItem, decision: "approve" | "reject") {
    setBusyId(proposal.id);
    setErr(null);
    setMessage(null);
    try {
      const auth = await ensureAuthHeaders();
      await reviewKnowledgeFeedbackProposal(proposal.id, decision, auth);
      setMessage(decision === "approve" ? "Proposal onaylandı; uygulamadan önce eval gate çalıştırılmalı." : "Proposal reddedildi.");
      await load();
    } catch {
      setErr("Proposal kararı kaydedilemedi.");
    } finally {
      setBusyId(null);
    }
  }

  if (!account?.address) {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
        {walletConnectForStudio}
      </section>
    );
  }

  const pendingCount = proposals.filter((item) => item.status === "PENDING").length;
  const gatePassedCount = applyRecords?.data.filter((item) => item.status === "GATE_PASSED").length ?? 0;
  const topSummary = summary?.data.slice(0, 3) ?? [];

  return (
    <section className="space-y-4 rounded-2xl border border-r3mes-border bg-r3mes-surface/25 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
            Learning gate
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Feedback önerileri
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">
            Chat feedback’i doğrudan sistemi değiştirmez. Önce proposal olur, impact dry-run raporu alınır, sonra insan onayı ve eval gate gerekir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-400/40 disabled:opacity-50"
          >
            Yenile
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading}
            className="rounded-full border border-cyan-500/35 bg-cyan-950/20 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:border-cyan-400/60 disabled:opacity-50"
          >
            Proposal üret
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Feedback</p>
          <p className="mt-1 text-2xl font-semibold text-white">{summary?.totalFeedback ?? 0}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Proposal</p>
          <p className="mt-1 text-2xl font-semibold text-white">{proposals.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Pending</p>
          <p className="mt-1 text-2xl font-semibold text-amber-100">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Gate passed</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-100">{gatePassedCount}</p>
        </div>
      </div>

      {err ? <p className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">{err}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 px-3 py-2 text-sm text-emerald-100">{message}</p> : null}

      {topSummary.length > 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-black/15 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">En güçlü sinyaller</p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            {topSummary.map((item) => (
              <li key={item.key}>
                {item.suggestedAction ?? "NO_ACTION"} · total={item.total} · wrong={item.wrongSourceCount} · missing={item.missingSourceCount} · bad={item.badAnswerCount} · source={shortId(item.collectionId)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {applyRecords && applyRecords.data.length > 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-black/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Apply review queue</p>
            <p className="text-[11px] text-zinc-600">Auto-apply kapalı · son karar insan kontrolünde</p>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-zinc-400">
            {applyRecords.data.slice(0, 5).map((record) => (
              <li key={record.id} className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${applyRecordStatusClass(record.status)}`}>
                    {record.status}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    record={shortId(record.id)} · proposal={shortId(record.proposalId)}
                  </span>
                </div>
                <p className="mt-1 text-zinc-500">
                  gate={record.gateCheckedAt ? new Date(record.gateCheckedAt).toLocaleString("tr-TR") : "bekliyor"} · reason={record.reason ?? "-"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {proposals.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-black/15 px-3 py-3 text-sm text-zinc-500">
          Henüz proposal yok. Chat ekranından feedback verip sonra “Proposal üret” ile aday oluşturabilirsiniz.
        </p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((proposal) => {
            const proposalImpact = impact[proposal.id];
            const proposalApplyPlan = applyPlan[proposal.id];
            const isBusy = busyId === proposal.id;
            return (
              <li key={proposal.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-zinc-100">{actionLabel(proposal.action)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(proposal.status)}`}>
                        {proposal.status}
                      </span>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-500">
                        confidence {Math.round(proposal.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-400">{proposal.reason}</p>
                    <p className="font-mono text-[11px] text-zinc-600">
                      source={shortId(proposal.collectionId)} · expected={shortId(proposal.expectedCollectionId)} · query={shortId(proposal.queryHash)} · signals={signalCount(proposal)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void showImpact(proposal)}
                      disabled={isBusy}
                      className="rounded-full border border-sky-500/30 px-3 py-1.5 text-xs text-sky-100 hover:border-sky-400/60 disabled:opacity-50"
                    >
                      Impact
                    </button>
                    <button
                      type="button"
                      onClick={() => void showApplyPlan(proposal)}
                      disabled={isBusy}
                      className="rounded-full border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-400/60 disabled:opacity-50"
                    >
                      Apply plan
                    </button>
                    {proposal.status === "PENDING" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void review(proposal, "approve")}
                          disabled={isBusy}
                          className="rounded-full border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-100 hover:border-emerald-400/60 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void review(proposal, "reject")}
                          disabled={isBusy}
                          className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {proposal.status === "APPROVED" ? (
                      <button
                        type="button"
                        onClick={() => void recordApplyPlan(proposal)}
                        disabled={isBusy}
                        className="rounded-full border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-100 hover:border-emerald-400/60 disabled:opacity-50"
                      >
                        Record plan
                      </button>
                    ) : null}
                  </div>
                </div>
                {proposalImpact ? (
                  <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-950/10 p-3 text-xs leading-relaxed text-sky-100/80">
                    <p>
                      estimatedScoreDelta={proposalImpact.impact.estimatedScoreDelta} · risk={proposalImpact.impact.riskLevel} · next={proposalImpact.nextSafeAction}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-sky-100/65">
                      {proposalImpact.impact.rationale.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {proposalApplyPlan ? (
                  <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-950/10 p-3 text-xs leading-relaxed text-cyan-100/80">
                    <p>
                      mutation={String(proposalApplyPlan.mutationEnabled)} · applyAllowed={String(proposalApplyPlan.applyAllowed)} · gate={proposalApplyPlan.requiredGate}
                    </p>
                    {proposalApplyPlan.blockedReasons.length > 0 ? (
                      <p className="mt-1 text-cyan-100/65">
                        Blok: {proposalApplyPlan.blockedReasons.join(" · ")}
                      </p>
                    ) : null}
                    <ul className="mt-2 space-y-2">
                      {proposalApplyPlan.steps.map((step) => (
                        <li key={step.id} className="rounded-lg border border-cyan-500/15 bg-black/15 p-2">
                          <p className="font-mono text-[11px] text-cyan-100">
                            {step.kind} · delta={step.scoreDelta} · target={shortId(step.targetCollectionId)}
                          </p>
                          <p className="mt-1 text-cyan-100/65">{step.rationale}</p>
                          <p className="mt-1 text-cyan-100/50">Rollback: {step.rollback}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
