import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "./prisma.js";

export function sha256HexBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type QaWebhookClaimResult =
  | { kind: "proceed" }
  | { kind: "duplicate"; jobId: string }
  | { kind: "conflict" }
  | { kind: "in_flight"; jobId: string };

/**
 * Aynı jobId için tek seferlik işlem hakkı: başarılı bitince `completeQaWebhookJob` çağrılır.
 * Başarısızlıkta `releaseQaWebhookClaim` ile kayıt silinerek yeniden deneme açılır.
 */
export async function claimQaWebhookJob(jobId: string, bodySha256: string): Promise<QaWebhookClaimResult> {
  try {
    await prisma.qaWebhookReceipt.create({
      data: { jobId, bodySha256 },
    });
    return { kind: "proceed" };
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
      throw e;
    }
  }

  const existing = await prisma.qaWebhookReceipt.findUnique({
    where: { jobId },
  });
  if (!existing) {
    return { kind: "proceed" };
  }
  if (existing.bodySha256 !== bodySha256) {
    return { kind: "conflict" };
  }
  if (existing.completedAt) {
    return { kind: "duplicate", jobId };
  }
  return { kind: "in_flight", jobId };
}

export async function completeQaWebhookJob(jobId: string): Promise<void> {
  await prisma.qaWebhookReceipt.update({
    where: { jobId },
    data: { completedAt: new Date() },
  });
}

export async function releaseQaWebhookClaim(jobId: string): Promise<void> {
  await prisma.qaWebhookReceipt.delete({ where: { jobId } }).catch(() => {
    /* idempotent release */
  });
}
