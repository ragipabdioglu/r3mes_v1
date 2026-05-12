import { createHash } from "node:crypto";

const baseUrl = (process.env.R3MES_BACKEND_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const wallet = process.env.R3MES_DEV_WALLET ?? "0x0000000000000000000000000000000000000000000000000000000000000abc";

function hashQuery(query) {
  return createHash("sha256").update(query.trim(), "utf8").digest("hex").slice(0, 16);
}

function authHeaders() {
  const now = Math.floor(Date.now() / 1000);
  return {
    "x-wallet-address": wallet,
    "x-message": JSON.stringify({ iat: now, exp: now + 900, address: wallet }),
    "x-signature": "dev-feedback-lifecycle-smoke",
  };
}

async function request(path, opts = {}) {
  const headers = {
    ...authHeaders(),
    ...(opts.body == null ? {} : { "content-type": "application/json" }),
    ...(opts.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers,
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }
  }
  if (!response.ok) {
    throw new Error(`${opts.method ?? "GET"} ${path} failed ${response.status}: ${raw.slice(0, 1000)}`);
  }
  return body;
}

function firstAccessibleCollection(listResponse) {
  const rows = Array.isArray(listResponse?.data) ? listResponse.data : [];
  return rows.find((item) => item?.id && item?.documentCount > 0) ?? rows.find((item) => item?.id) ?? null;
}

async function main() {
  const started = Date.now();
  const health = await request("/health");
  const collections = await request("/v1/knowledge?scope=all&limit=25");
  const collection = firstAccessibleCollection(collections);
  if (!collection) {
    throw new Error("No accessible knowledge collection found for feedback lifecycle smoke.");
  }

  const query = `feedback lifecycle smoke ${new Date().toISOString()}`;
  const queryHash = hashQuery(query);
  const feedback = await request("/v1/feedback/knowledge", {
    method: "POST",
    body: JSON.stringify({
      kind: "GOOD_SOURCE",
      query,
      collectionId: collection.id,
      reason: "Automated feedback lifecycle smoke: scoped good-source signal.",
      metadata: {
        evalQuery: query,
        smoke: "feedback_lifecycle",
        generatedAt: new Date().toISOString(),
      },
    }),
  });

  const generated = await request("/v1/feedback/knowledge/proposals/generate?minSignals=1&limit=100", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const proposal = (generated.data ?? []).find((item) => item.queryHash === queryHash && item.collectionId === collection.id);
  if (!proposal) {
    throw new Error(`No generated proposal found for queryHash=${queryHash} collection=${collection.id}`);
  }

  const approved = await request(`/v1/feedback/knowledge/proposals/${encodeURIComponent(proposal.id)}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const impact = await request(`/v1/feedback/knowledge/proposals/${encodeURIComponent(proposal.id)}/impact`);
  const applyPlan = await request(`/v1/feedback/knowledge/proposals/${encodeURIComponent(proposal.id)}/apply-plan`);
  const applyRecord = await request(`/v1/feedback/knowledge/proposals/${encodeURIComponent(proposal.id)}/apply-records`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const gateReport = {
    ok: true,
    quick: true,
    applyAllowed: true,
    approvedProposalCount: 1,
    feedbackCaseCount: 1,
    feedbackCaseCoverageOk: true,
    generatedAt: new Date().toISOString(),
    checks: [
      { name: "feedback_lifecycle_smoke", ok: true, skipped: false, durationMs: 0 },
      { name: "rag_quality_gates", ok: true, skipped: true, durationMs: 0 },
      { name: "collection_suggestion", ok: true, skipped: true, durationMs: 0 },
      { name: "production_rag_gate", ok: true, skipped: true, durationMs: 0 },
    ],
  };
  const gateResult = await request(`/v1/feedback/knowledge/apply-records/${encodeURIComponent(applyRecord.record.id)}/gate-result`, {
    method: "POST",
    body: JSON.stringify({
      ok: true,
      report: gateReport,
      reason: "feedback lifecycle smoke gate passed",
    }),
  });
  const passiveApply = await request(`/v1/feedback/knowledge/apply-records/${encodeURIComponent(applyRecord.record.id)}/apply-passive`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const promotionGate = await request(`/v1/feedback/knowledge/router-adjustments/promotion-gate?queryHash=${queryHash}`);

  const rollbackResults = [];
  for (const adjustment of passiveApply.adjustments ?? []) {
    if (!adjustment?.id) continue;
    const rolledBack = await request(`/v1/feedback/knowledge/router-adjustments/${encodeURIComponent(adjustment.id)}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason: "feedback lifecycle smoke cleanup" }),
    });
    rollbackResults.push(rolledBack.adjustment);
  }

  const summary = {
    ok: true,
    baseUrl,
    health,
    collection: { id: collection.id, name: collection.name },
    queryHash,
    feedbackId: feedback.id,
    proposalId: proposal.id,
    proposalStatus: approved.proposal?.status ?? null,
    impactNextSafeAction: impact.nextSafeAction,
    applyPlan: {
      requiredGate: applyPlan.requiredGate,
      applyAllowed: applyPlan.applyAllowed,
      stepCount: applyPlan.steps?.length ?? 0,
    },
    applyRecordId: applyRecord.record.id,
    gatePassed: gateResult.gatePassed,
    passiveAdjustmentCount: passiveApply.adjustments?.length ?? 0,
    promotionGate: {
      total: promotionGate.total,
      promotionCandidateCount: (promotionGate.data ?? []).filter((item) => item.promotionCandidate).length,
      rollbackRecommendedCount: (promotionGate.data ?? []).filter((item) => item.rollbackRecommended).length,
      stages: (promotionGate.data ?? []).reduce((acc, item) => {
        const key = item.promotionStage ?? "missing";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    rollbackCount: rollbackResults.length,
    durationMs: Date.now() - started,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
