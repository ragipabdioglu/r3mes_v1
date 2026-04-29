#!/usr/bin/env node
/**
 * Faz 7 — Upload → QA webhook → ACTIVE → chat (adapter çözümü) smoke.
 * Önkoşul: API + DB + Redis + IPFS + R3MES_QA_WEBHOOK_SECRET (sunucu ile aynı).
 * Kolaylık: sunucuda R3MES_SKIP_WALLET_AUTH=1, R3MES_DEV_WALLET, R3MES_SKIP_CHAT_FEE=1.
 *
 * Kullanım:
 *   R3MES_QA_WEBHOOK_SECRET=... R3MES_E2E_BASE_URL=http://127.0.0.1:3000 node scripts/e2e-lifecycle-smoke.mjs
 */

import { createHmac } from "node:crypto";

const base = (process.env.R3MES_E2E_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.R3MES_QA_WEBHOOK_SECRET?.trim();

function fail(msg, code = 1) {
  console.error(`[e2e-lifecycle-smoke] ${msg}`);
  process.exit(code);
}

function signBody(raw) {
  return createHmac("sha256", secret).update(raw, "utf8").digest("hex");
}

async function main() {
  if (!secret) {
    fail("R3MES_QA_WEBHOOK_SECRET ortam değişkeni gerekli (sunucudaki ile aynı olmalı).", 1);
  }

  console.log(`[e2e] base URL: ${base}`);

  const h = await fetch(`${base}/health`);
  if (!h.ok) fail(`GET /health beklenen 200, alınan ${h.status}`, 2);
  console.log("[1] GET /health ok");

  const form = new FormData();
  /** Minimal bayt: GGUF sihri (upload doğrulaması); gerçek inference için tam GGUF gerekir. */
  const minimal = new Uint8Array(32);
  minimal.set([0x47, 0x47, 0x55, 0x46], 0);
  form.append("weights", new Blob([minimal]), "e2e-smoke.gguf");

  const up = await fetch(`${base}/v1/adapters`, { method: "POST", body: form });
  const upText = await up.text();
  if (!up.ok) {
    fail(`POST /v1/adapters ${up.status}: ${upText.slice(0, 500)}`, 3);
  }
  let upload;
  try {
    upload = JSON.parse(upText);
  } catch {
    fail(`Upload yanıtı JSON değil: ${upText.slice(0, 200)}`, 3);
  }
  const adapterId = upload.adapterId ?? upload.adapterDbId;
  const weightsCid = upload.weightsCid;
  const jobId = upload.benchmarkJobId;
  if (!adapterId || !weightsCid || !jobId) {
    fail(`Upload yanıtında adapterId / weightsCid / benchmarkJobId eksik: ${upText.slice(0, 400)}`, 3);
  }
  console.log("[2] POST /v1/adapters ok", { adapterId, weightsCid: weightsCid.slice(0, 16) + "…", jobId });

  const qaPayload = {
    jobId,
    adapterCid: weightsCid,
    status: "approved",
    score: 88.5,
  };
  const rawQa = JSON.stringify(qaPayload);
  const qa = await fetch(`${base}/v1/internal/qa-result`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qa-hmac": signBody(rawQa),
    },
    body: rawQa,
  });
  const qaText = await qa.text();
  if (!qa.ok) {
    fail(`POST /v1/internal/qa-result ${qa.status}: ${qaText.slice(0, 500)}`, 4);
  }
  console.log("[3] POST /v1/internal/qa-result ok", qaText.slice(0, 200));

  const detail = await fetch(`${base}/v1/adapters/${adapterId}`);
  const detailText = await detail.text();
  if (!detail.ok) fail(`GET /v1/adapters/${adapterId} ${detail.status}: ${detailText}`, 5);
  const detailJson = JSON.parse(detailText);
  if (detailJson.status !== "ACTIVE") {
    fail(`Beklenen status ACTIVE, alınan: ${detailJson.status}`, 5);
  }
  console.log("[4] GET /v1/adapters/:id ACTIVE ok", { benchmarkScore: detailJson.benchmarkScore });

  const chatBody = JSON.stringify({
    adapter_db_id: adapterId,
    messages: [{ role: "user", content: "e2e lifecycle ping" }],
  });
  const chat = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: chatBody,
  });
  const chatText = await chat.text();
  if (chat.status === 400) {
    try {
      const err = JSON.parse(chatText);
      if (err.error === "ADAPTER_RESOLUTION_FAILED") {
        fail("Chat 400 ADAPTER_RESOLUTION_FAILED — adapter çözümü başarısız (beklenmiyor).", 6);
      }
    } catch {
      /* ignore */
    }
  }
  console.log("[5] POST /v1/chat/completions", { status: chat.status, bodyPreview: chatText.slice(0, 120) });

  if (chat.status >= 500) {
    console.warn("[e2e] Chat upstream veya sunucu hatası olabilir; adapter çözümü logda chat_proxy_resolved olmalı.");
  }

  console.log("[e2e] Tamam — zincir tamamlandı. Loglarda e2eLifecycle: upload_accepted → qa_webhook_applied → chat_proxy_resolved doğrulanabilir.");
  console.log(
    `\n[kanıt] Canlı DB+API zinciri: DATABASE_URL=... R3MES_VERIFY_BASE_URL=${base} node scripts/verify-lifecycle-chain.mjs --adapter-id ${adapterId} --job-id ${jobId}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
