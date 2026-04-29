#!/usr/bin/env node
/**
 * Terminal adapter + enqueueBenchmarkJob jobId formülü ile eşleşen tamamlanmış receipt bulur.
 * Çıktı: tek satır JSON { adapterId, jobId } veya {}
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
try {
  const adapters = await p.adapter.findMany({
    where: { status: { in: ["ACTIVE", "REJECTED"] } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, weightsCid: true, onChainAdapterId: true, status: true },
  });
  for (const a of adapters) {
    const wc = a.weightsCid;
    if (!wc || wc.length < 24) continue;
    const oc = a.onChainAdapterId?.toString() ?? "0";
    const jobId = `benchmark-${oc}-${wc.slice(0, 24)}`;
    const r = await p.qaWebhookReceipt.findUnique({
      where: { jobId },
      select: { completedAt: true },
    });
    if (r?.completedAt) {
      console.log(JSON.stringify({ adapterId: a.id, jobId, adapterStatus: a.status }));
      process.exit(0);
    }
  }
  console.log(JSON.stringify({}));
} finally {
  await p.$disconnect();
}
