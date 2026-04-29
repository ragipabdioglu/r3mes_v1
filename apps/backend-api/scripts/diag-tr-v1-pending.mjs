/**
 * tr-v1 PENDING_REVIEW teşhisi: adapter + beklenen jobId + QaWebhookReceipt var mı
 * Kullanım: DATABASE_URL=... node scripts/diag-tr-v1-pending.mjs
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
try {
  const adapters = await p.adapter.findMany({
    where: {
      OR: [
        { name: { contains: "tr-v1", mode: "insensitive" } },
        { name: { contains: "trv1", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      weightsCid: true,
      onChainAdapterId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log("=== Adapters matching tr-v1 / trv1 ===\n");
  for (const row of adapters) {
    const wc = row.weightsCid || "";
    const oc = row.onChainAdapterId?.toString() ?? "0";
    const expectedJobId = `benchmark-${oc}-${wc.slice(0, 24)}`;
    const receipt = await p.qaWebhookReceipt.findUnique({
      where: { jobId: expectedJobId },
      select: { jobId: true, completedAt: true, createdAt: true },
    });

    console.log(JSON.stringify({ ...row, expectedJobId, receipt: receipt ?? null }, null, 2));
    console.log("---");
  }

  if (adapters.length === 0) {
    console.log("(No rows — DB empty or no name match.)");
  }

  console.log(
    "\nPENDING_REVIEW nedeni: status yalnızca POST /v1/internal/qa-result başarılı olunca ACTIVE/REJECTED olur; receipt yoksa callback hiç gelmemiş.",
  );
} finally {
  await p.$disconnect();
}
