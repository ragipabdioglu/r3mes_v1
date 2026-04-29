#!/usr/bin/env node
/**
 * Canlı: callback sonrası receipt / status / score / updatedAt kanıtı (API ± DB).
 *
 * Taban model ailesi (Qwen, MoE vb.) backend sözleşmesini değiştirmez: aynı upload,
 * aynı `POST /v1/internal/qa-result`, aynı `Adapter` / `QaWebhookReceipt` tabloları.
 * Qwen hattı farkı AI engine / worker / benchmark konfigürasyonundadır.
 *
 * Önkoşul (upload yanıtından): adapterId, benchmarkJobId (= jobId), weightsCid
 *
 *   R3MES_VERIFY_BASE_URL=... DATABASE_URL=... \
 *   node scripts/verify-lifecycle-chain.mjs --adapter-id <id> --job-id <benchmarkJobId>
 *
 * Log: sunucuda `e2eLifecycle: qa_webhook_applied` ve jobId ile arayın.
 */

function parseArgs(argv) {
  const out = { adapterId: null, jobId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--adapter-id=")) out.adapterId = a.slice("--adapter-id=".length);
    else if (a === "--adapter-id") out.adapterId = argv[++i];
    else if (a.startsWith("--job-id=")) out.jobId = a.slice("--job-id=".length);
    else if (a === "--job-id") out.jobId = argv[++i];
  }
  return out;
}

function fail(msg, code = 1) {
  console.error(`[verify-lifecycle-chain] ${msg}`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`verify-lifecycle-chain.mjs — canlı QA callback zinciri doğrulama

Gerekli:
  --adapter-id <id>     Upload yanıtındaki adapterId

İsteğe bağlı (tam kanıt için önerilir):
  --job-id <id>         benchmarkJobId — QaWebhookReceipt.completedAt doğrulaması (DATABASE_URL gerekir)

Ortam:
  R3MES_VERIFY_BASE_URL veya R3MES_E2E_BASE_URL
  DATABASE_URL          Tam rapor + receipt için
`);
    process.exit(0);
  }

  if (!args.adapterId?.trim()) {
    fail("--adapter-id gerekli (--help)", 2);
  }

  const base = (process.env.R3MES_VERIFY_BASE_URL ?? process.env.R3MES_E2E_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) {
    fail("R3MES_VERIFY_BASE_URL veya R3MES_E2E_BASE_URL tanımlı olmalı.", 2);
  }

  const adapterId = args.adapterId.trim();
  const jobId = args.jobId?.trim() ?? null;

  console.log("=== Lifecycle chain verification ===\n");

  const url = `${base}/v1/adapters/${encodeURIComponent(adapterId)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    fail(`GET ${url} → ${res.status}: ${text.slice(0, 400)}`, 3);
  }

  let api;
  try {
    api = JSON.parse(text);
  } catch {
    fail(`Yanıt JSON değil: ${text.slice(0, 200)}`, 3);
  }

  const status = api.status;
  const score = api.benchmarkScore;
  const weightsCid = api.weightsCid;
  const updatedAtApi = api.updatedAt;

  console.log("[API] GET /v1/adapters/:id → 200");
  console.log(`  adapterId: ${api.id ?? adapterId}`);
  console.log(`  weightsCid: ${weightsCid ?? "—"}`);
  console.log(`  status: ${status}`);
  console.log(`  benchmarkScore: ${score === null || score === undefined ? String(score) : JSON.stringify(score)}`);
  console.log(`  updatedAt: ${updatedAtApi ?? "—"}`);

  const terminal = status === "ACTIVE" || status === "REJECTED";
  if (!terminal) {
    fail(
      `Beklenen terminal durum ACTIVE veya REJECTED; şu an: ${status} (callback henüz işlenmemiş veya PENDING olabilir).`,
      4,
    );
  }

  if (score === undefined) {
    fail("API yanıtında benchmarkScore alanı yok (sözleşme ihlali).", 4);
  }

  const report = {
    callback200: "—",
    receiptOk: "—",
    statusOk: `Evet (${status})`,
    scoreOk: score !== null && score !== undefined ? "Evet" : "Hayır (null — beklenmeyebilir)",
    verifyPass: "—",
    chainClosed: "—",
    marketplaceChat: "",
    official: {
      callback200: "Kanıtlanamadı",
      receipt: "Kanıtlanamadı",
      completedAt: "Kanıtlanamadı",
      status: status,
      score: score !== null && score !== undefined ? "Evet" : "Hayır",
      verify: "—",
      chainClosed: "Hayır",
    },
  };

  if (score !== null && score !== undefined) {
    report.scoreOk = "Evet";
  }

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    report.receiptOk = "Kanıtlanamadı (DATABASE_URL yok)";
    report.callback200 = "Kanıtlanamadı (receipt için DB gerekir)";
    report.verifyPass = "Kısmi";
    report.chainClosed = "Hayır — receipt DB doğrulaması yok";
    report.official.verify = "Kısmi";
    report.official.chainClosed = "Hayır";
    report.marketplaceChat =
      status === "ACTIVE"
        ? "Pazaryeri: ACTIVE. Chat: DB receipt doğrulanmadan kesin değil."
        : "Pazaryeri: REJECTED görünmez. Chat: muhtemelen kapalı.";
    printReport(report);
    printOfficialSummary(report, adapterId, jobId);
    console.log("\n[DB] DATABASE_URL yok — receipt / callback tam kanıtı için tekrar çalıştırın.");
    process.exit(0);
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const row = await prisma.adapter.findUnique({
      where: { id: adapterId },
      select: {
        id: true,
        status: true,
        benchmarkScore: true,
        weightsCid: true,
        updatedAt: true,
      },
    });
    if (!row) {
      fail(`DB: Adapter id=${adapterId} bulunamadı.`, 5);
    }

    console.log("\n[DB] Adapter");
    console.log(`  status: ${row.status}`);
    console.log(`  benchmarkScore: ${row.benchmarkScore != null ? String(row.benchmarkScore) : "null"}`);
    console.log(`  updatedAt: ${row.updatedAt.toISOString()}`);

    if (row.status !== status) {
      fail(`API status=${status} ama DB status=${row.status}`, 5);
    }

    const dbScore = row.benchmarkScore != null ? Number(row.benchmarkScore) : null;
    const apiScore = score === null ? null : Number(score);
    if (dbScore !== apiScore && !(Number.isNaN(dbScore) && Number.isNaN(apiScore))) {
      console.warn(`  UYARI: benchmarkScore API=${apiScore} DB=${dbScore}`);
    }

    if (jobId) {
      const receipt = await prisma.qaWebhookReceipt.findUnique({
        where: { jobId },
        select: { jobId: true, bodySha256: true, completedAt: true, createdAt: true },
      });
      if (!receipt) {
        fail(`DB: QaWebhookReceipt jobId=${jobId} yok (callback hiç gelmemiş veya jobId upload ile aynı değil).`, 5);
      }
      console.log("\n[DB] QaWebhookReceipt");
      console.log(`  jobId: ${receipt.jobId}`);
      console.log(`  bodySha256: ${receipt.bodySha256.slice(0, 16)}…`);
      console.log(`  createdAt: ${receipt.createdAt.toISOString()}`);
      console.log(`  completedAt: ${receipt.completedAt ? receipt.completedAt.toISOString() : "(null)"}`);

      if (!receipt.completedAt) {
        fail("Receipt var ama completedAt null — callback handler tamamlanmadı (403/500 veya yarış).", 5);
      }

      report.receiptOk = `Evet (jobId=${jobId}, completedAt=${receipt.completedAt.toISOString()})`;
      report.callback200 =
        "Evet (completedAt set → handler başarıyla bitti; 200 veya duplicate 200 — 403/409/503 ile completedAt yazılmaz)";
    } else {
      console.log("\n[DB] --job-id verilmedi — QaWebhookReceipt kontrolü atlandı.");
      report.receiptOk = "Atlandı (--job-id yok)";
      report.callback200 = "Kanıtlanamadı (job-id ile receipt satırı gerekir)";
    }

    report.verifyPass = jobId && report.receiptOk.startsWith("Evet") ? "PASS" : "Kısmi";
    report.chainClosed =
      jobId && report.receiptOk.startsWith("Evet")
        ? "Evet — API terminal status + DB receipt + score + updatedAt"
        : "Kısmi — --job-id ile tamamlayın";

    const fullProof = Boolean(jobId && report.receiptOk.startsWith("Evet"));
    report.official.callback200 = fullProof ? "Evet" : "Kanıtlanamadı";
    report.official.receipt = fullProof ? "Evet" : jobId ? "Hayır" : "Kanıtlanamadı";
    report.official.completedAt = fullProof ? "Evet" : jobId ? "Hayır" : "Kanıtlanamadı";
    report.official.status = status;
    report.official.score = score !== null && score !== undefined ? "Evet" : "Hayır";
    report.official.verify = report.verifyPass;
    report.official.chainClosed = report.verifyPass === "PASS" ? "Evet" : "Hayır";

    report.marketplaceChat =
      status === "ACTIVE"
        ? "Pazaryeri: ACTIVE listelenir. Chat: adapter_db_id ile sohbet açık."
        : "Pazaryeri: REJECTED listelenmez. Chat: adapter_db_id ile sohbet kapalı (ADAPTER_NOT_ACTIVE).";

    printReport(report);
    printOfficialSummary(report, adapterId, jobId);
  } finally {
    await prisma.$disconnect();
  }

  process.exit(0);
}

/**
 * @param {object} r
 */
function printReport(r) {
  console.log("\n=== Canlı doğrulama raporu ===\n");
  console.log(`- Callback 200 / duplicate 200: ${r.callback200}`);
  console.log(`- Receipt (completedAt): ${r.receiptOk}`);
  console.log(`- Status ACTIVE veya REJECTED: ${r.statusOk}`);
  console.log(`- benchmarkScore yazıldı: ${r.scoreOk}`);
  console.log(`- verify:lifecycle-chain: ${r.verifyPass}`);
  console.log(`- Backend zinciri canlıda kapandı: ${r.chainClosed}`);
  console.log(`- Pazaryeri / chat hazırlığı: ${r.marketplaceChat}`);
  console.log("");
}

/** Tek koşu — Faz6 / ORTAK kaydı için kopyala-yapıştır */
function printOfficialSummary(r, adapterId, jobId) {
  const o = r.official;
  console.log("=== Resmi özet (tek canlı koşu) ===\n");
  console.log(`callback 200 oldu mu: ${o.callback200}`);
  console.log(`receipt oluştu mu: ${o.receipt}`);
  console.log(`completedAt dolu mu: ${o.completedAt}`);
  console.log(`status ne oldu: ${o.status}`);
  console.log(`score yazıldı mı: ${o.score}`);
  console.log(`verify: ${o.verify}`);
  console.log(`backend zinciri resmi olarak kapandı mı: ${o.chainClosed}`);
  console.log("");
  const jid = jobId ?? "—";
  console.log(
    `OFFICIAL_VERIFY_LINE: verify=${o.verify} adapterId=${adapterId} jobId=${jid} status=${o.status} receipt=${o.receipt} completedAt=${o.completedAt} score=${o.score} chain=${o.chainClosed}`,
  );
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
