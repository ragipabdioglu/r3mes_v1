"use client";

import { useCurrentAccount } from "@mysten/dapp-kit";
import { useCallback, useEffect, useState } from "react";

import {
  createKnowledgeFeedbackApplyRecord,
  fetchKnowledgeFeedbackApplyPlan,
  fetchKnowledgeFeedbackApplyRecords,
  fetchKnowledgeFeedbackMutationPreview,
  fetchKnowledgeFeedbackProposalImpact,
  fetchKnowledgeFeedbackProposals,
  fetchKnowledgeFeedbackPromotionGate,
  fetchKnowledgeFeedbackRouterAdjustments,
  fetchKnowledgeFeedbackRouterScoringSimulation,
  fetchKnowledgeFeedbackSummary,
  generateKnowledgeFeedbackProposals,
  passiveApplyKnowledgeFeedbackRecord,
  reviewKnowledgeFeedbackProposal,
  rollbackKnowledgeFeedbackAdjustment,
  type KnowledgeFeedbackApplyRecordItem,
  type KnowledgeFeedbackApplyRecordListResponse,
  type KnowledgeFeedbackApplyMutationPreviewResponse,
  type KnowledgeFeedbackApplyPlanResponse,
  type KnowledgeFeedbackProposalImpactResponse,
  type KnowledgeFeedbackProposalItem,
  type KnowledgeFeedbackPromotionGateResponse,
  type KnowledgeFeedbackRouterAdjustmentListResponse,
  type KnowledgeFeedbackRouterScoringSimulationResponse,
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

function formatDurationMs(value: number | null): string {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function boolLabel(value: boolean | null | undefined, yes: string, no: string, unknown = "unknown"): string {
  if (value === true) return yes;
  if (value === false) return no;
  return unknown;
}

function countLabel(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

export function FeedbackLearningBoard() {
  const account = useCurrentAccount();
  const { ensureAuthHeaders } = useR3mesWalletAuth();
  const [summary, setSummary] = useState<KnowledgeFeedbackSummaryResponse | null>(null);
  const [proposals, setProposals] = useState<KnowledgeFeedbackProposalItem[]>([]);
  const [applyRecords, setApplyRecords] = useState<KnowledgeFeedbackApplyRecordListResponse | null>(null);
  const [routerAdjustments, setRouterAdjustments] = useState<KnowledgeFeedbackRouterAdjustmentListResponse | null>(null);
  const [scoringSimulation, setScoringSimulation] = useState<KnowledgeFeedbackRouterScoringSimulationResponse | null>(null);
  const [promotionGate, setPromotionGate] = useState<KnowledgeFeedbackPromotionGateResponse | null>(null);
  const [mutationPreview, setMutationPreview] = useState<Record<string, KnowledgeFeedbackApplyMutationPreviewResponse>>({});
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
      setRouterAdjustments(null);
      setScoringSimulation(null);
      setPromotionGate(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const [nextSummary, nextProposals, nextApplyRecords, nextAdjustments, nextSimulation, nextPromotionGate] = await Promise.all([
        fetchKnowledgeFeedbackSummary(auth),
        fetchKnowledgeFeedbackProposals(auth, "all"),
        fetchKnowledgeFeedbackApplyRecords(auth, "all"),
        fetchKnowledgeFeedbackRouterAdjustments(auth, "all"),
        fetchKnowledgeFeedbackRouterScoringSimulation(auth),
        fetchKnowledgeFeedbackPromotionGate(auth),
      ]);
      setSummary(nextSummary);
      setProposals(nextProposals);
      setApplyRecords(nextApplyRecords);
      setRouterAdjustments(nextAdjustments);
      setScoringSimulation(nextSimulation);
      setPromotionGate(nextPromotionGate);
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

  async function showMutationPreview(record: KnowledgeFeedbackApplyRecordItem) {
    setBusyId(record.id);
    setErr(null);
    try {
      const auth = await ensureAuthHeaders();
      const preview = await fetchKnowledgeFeedbackMutationPreview(record.id, auth);
      setMutationPreview((current) => ({ ...current, [record.id]: preview }));
    } catch {
      setErr("Mutation preview alınamadı.");
    } finally {
      setBusyId(null);
    }
  }

  async function passiveApply(record: KnowledgeFeedbackApplyRecordItem) {
    setBusyId(record.id);
    setErr(null);
    setMessage(null);
    try {
      const auth = await ensureAuthHeaders();
      const applied = await passiveApplyKnowledgeFeedbackRecord(record.id, auth);
      setMessage(`${applied.adjustments.length} passive adjustment kaydedildi. Router runtime etkilenmedi.`);
      await load();
    } catch {
      setErr("Passive apply yapılamadı. Gate durumu veya record statüsünü kontrol edin.");
    } finally {
      setBusyId(null);
    }
  }

  async function rollbackAdjustment(adjustmentId: string) {
    setBusyId(adjustmentId);
    setErr(null);
    setMessage(null);
    try {
      const auth = await ensureAuthHeaders();
      await rollbackKnowledgeFeedbackAdjustment(adjustmentId, auth);
      setMessage("Passive adjustment rollback edildi. Router runtime zaten etkilenmemişti.");
      await load();
    } catch {
      setErr("Adjustment rollback yapılamadı.");
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
  const activeAdjustmentCount = routerAdjustments?.data.filter((item) => item.status === "ACTIVE").length ?? 0;
  const simulatedImpactCount = scoringSimulation?.results.length ?? 0;
  const promotionCandidateCount = promotionGate?.data.filter((item) => item.promotionCandidate).length ?? 0;
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

      <div className="grid gap-2 sm:grid-cols-6">
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
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Passive adj.</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-100">{activeAdjustmentCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Simulated</p>
          <p className="mt-1 text-2xl font-semibold text-sky-100">{simulatedImpactCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Promote</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-100">{promotionCandidateCount}</p>
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
                {(() => {
                  const preview = mutationPreview[record.id];
                  return (
                    <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${applyRecordStatusClass(record.status)}`}>
                    {record.status}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    record={shortId(record.id)} · proposal={shortId(record.proposalId)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void showMutationPreview(record)}
                    disabled={busyId === record.id}
                    className="rounded-full border border-cyan-500/25 px-2 py-0.5 text-[10px] text-cyan-100 hover:border-cyan-400/60 disabled:opacity-50"
                  >
                    Preview diff
                  </button>
                  {record.status === "GATE_PASSED" ? (
                    <button
                      type="button"
                      onClick={() => void passiveApply(record)}
                      disabled={busyId === record.id}
                      className="rounded-full border border-emerald-500/25 px-2 py-0.5 text-[10px] text-emerald-100 hover:border-emerald-400/60 disabled:opacity-50"
                    >
                      Passive apply
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-zinc-500">
                  gate={record.gateCheckedAt ? new Date(record.gateCheckedAt).toLocaleString("tr-TR") : "bekliyor"} · reason={record.reason ?? "-"}
                </p>
                {record.gateReportSummary ? (
                  <div className="mt-2 rounded-lg border border-zinc-800 bg-black/20 p-2 text-[11px] text-zinc-500">
                    <p>
                      gateOk={String(record.gateReportSummary.ok)} · checks={record.gateReportSummary.checksPassed}/{record.gateReportSummary.checksTotal} · failed={record.gateReportSummary.checksFailed} · duration={formatDurationMs(record.gateReportSummary.durationMs)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-zinc-700 bg-zinc-950/50 px-2 py-0.5">
                        apply={boolLabel(record.gateReportSummary.applyAllowed, "allowed", "blocked")}
                      </span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-950/50 px-2 py-0.5">
                        feedbackCases={countLabel(record.gateReportSummary.feedbackCaseCount)}
                      </span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-950/50 px-2 py-0.5">
                        coverage={boolLabel(record.gateReportSummary.feedbackCaseCoverageOk, "ok", "missing")}
                      </span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-950/50 px-2 py-0.5">
                        approved={countLabel(record.gateReportSummary.approvedProposalCount)}
                      </span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-950/50 px-2 py-0.5">
                        production={boolLabel(record.gateReportSummary.productionGateRan, "ran", "skipped")}
                      </span>
                    </div>
                    {record.gateReportSummary.failedChecks.length > 0 ? (
                      <p className="mt-1 text-rose-200/75">
                        Failed: {record.gateReportSummary.failedChecks.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {preview ? (
                  <div className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-2 text-[11px] text-cyan-100/75">
                    <p>
                      mutationApplied={String(preview.mutationApplied)} · applyAllowed={String(preview.applyAllowed)} · steps={preview.previewSteps.length}
                    </p>
                    {preview.blockedReasons.length > 0 ? (
                      <p className="mt-1 text-cyan-100/55">Blocked: {preview.blockedReasons.join(" · ")}</p>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {preview.previewSteps.map((step) => (
                        <li key={step.stepId} className="rounded-md border border-cyan-500/15 bg-black/15 p-2">
                          <p className="font-mono text-[10px] text-cyan-100">
                            {step.effect} · {step.mutationPath} · {shortId(step.targetCollectionId)}
                          </p>
                          <p className="mt-1 text-cyan-100/65">
                            score {step.simulatedCurrentScore ?? "-"} → {step.simulatedNextScore ?? "-"} · delta={step.scoreDelta}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                    </>
                  );
                })()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {routerAdjustments && routerAdjustments.data.length > 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-black/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Passive router adjustments</p>
            <p className="text-[11px] text-zinc-600">Read-only runtime · skorlamaya henüz bağlı değil</p>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-zinc-400">
            {routerAdjustments.data.slice(0, 5).map((item) => (
              <li key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${item.status === "ACTIVE" ? "border-cyan-500/25 bg-cyan-950/15 text-cyan-100" : "border-zinc-700 bg-zinc-950/60 text-zinc-400"}`}>
                    {item.status}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    adj={shortId(item.id)} · record={shortId(item.applyRecordId)} · collection={shortId(item.collectionId)}
                  </span>
                  {item.status === "ACTIVE" ? (
                    <button
                      type="button"
                      onClick={() => void rollbackAdjustment(item.id)}
                      disabled={busyId === item.id}
                      className="rounded-full border border-rose-500/25 px-2 py-0.5 text-[10px] text-rose-100 hover:border-rose-400/60 disabled:opacity-50"
                    >
                      Rollback
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-zinc-500">
                  {item.kind} · {item.mutationPath} · delta={item.scoreDelta} · simulated={item.simulatedBefore ?? "-"}→{item.simulatedAfter ?? "-"}
                </p>
                {item.rollbackReason ? (
                  <p className="mt-1 text-zinc-600">rollback={item.rollbackReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scoringSimulation && scoringSimulation.results.length > 0 ? (
        <div className="rounded-xl border border-sky-500/15 bg-sky-950/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-100/80">Scoring simulation</p>
            <p className="text-[11px] text-sky-100/45">
              Read-only · runtimeAffected={String(scoringSimulation.runtimeAffected)}
            </p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-sky-100/55">
            Aktif passive adjustment’lar router skoruna bağlansaydı oluşacak toplam etki. Canlı chat ve retrieval hâlâ etkilenmiyor.
          </p>
          <ul className="mt-3 space-y-2 text-xs text-sky-100/70">
            {scoringSimulation.results.slice(0, 5).map((item) => (
              <li key={`${item.collectionId ?? "-"}:${item.queryHash ?? "-"}`} className="rounded-lg border border-sky-500/15 bg-black/20 p-2">
                <p className="font-mono text-[11px] text-sky-100">
                  collection={shortId(item.collectionId)} · query={shortId(item.queryHash)}
                </p>
                <p className="mt-1 text-sky-100/60">
                  adjustments={item.activeAdjustmentCount} · delta={item.totalScoreDelta} · simulated={item.simulatedBefore}→{item.simulatedAfter}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {promotionGate && promotionGate.data.length > 0 ? (
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-950/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100/80">Promotion gate</p>
            <p className="text-[11px] text-emerald-100/45">
              promotionApplied={String(promotionGate.promotionApplied)} · runtimeAffected={String(promotionGate.runtimeAffected)}
            </p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-emerald-100/55">
            Passive adjustment’ların shadow runtime adaylığı. Bu panel yalnız karar raporu üretir; canlı router hâlâ değişmez.
          </p>
          <ul className="mt-3 space-y-2 text-xs text-emerald-100/70">
            {promotionGate.data.slice(0, 5).map((item) => (
              <li key={`${item.collectionId ?? "-"}:${item.queryHash ?? "-"}`} className="rounded-lg border border-emerald-500/15 bg-black/20 p-2">
                <p className="font-mono text-[11px] text-emerald-100">
                  {item.recommendation} · collection={shortId(item.collectionId)} · query={shortId(item.queryHash)}
                </p>
                <p className="mt-1 text-emerald-100/60">
                  candidate={String(item.promotionCandidate)} · gate={item.gatePassedCount}/{item.activeAdjustmentCount} · delta={item.totalScoreDelta}
                </p>
                {item.blockedReasons.length > 0 ? (
                  <p className="mt-1 text-amber-100/70">blocked={item.blockedReasons.join(" · ")}</p>
                ) : null}
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
