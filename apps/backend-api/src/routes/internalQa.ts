import type { FastifyInstance } from "fastify";
import { AdapterStatus, Prisma } from "@prisma/client";
import {
  type QaResultWebhookPayload,
  R3MES_TESTNET_MOCK_REGISTRY_ADMIN_CAP_OBJECT_ID,
} from "@r3mes/shared-types";
import type { FastifyRequestWithRawBody } from "../lib/qaHmac.js";
import {
  claimQaWebhookJob,
  completeQaWebhookJob,
  releaseQaWebhookClaim,
  sha256HexBuffer,
} from "../lib/qaWebhookIdempotency.js";
import { prisma } from "../lib/prisma.js";
import { qaHmacPreHandler, registerQaWebhookRawBodyCapture } from "../lib/qaHmac.js";
import { applyQaResultOnChain, getOperatorKeypair, getPublishedPackageId } from "../lib/suiOperator.js";

export async function registerInternalQaRoutes(app: FastifyInstance) {
  registerQaWebhookRawBodyCapture(app);
  app.post("/v1/internal/qa-result", { preHandler: qaHmacPreHandler }, async (req, reply) => {
    const body = req.body as QaResultWebhookPayload;
    if (!body?.adapterCid || body.jobId === undefined || body.jobId === "") {
      reply.code(400);
      return { error: "INVALID_BODY", message: "jobId ve adapterCid gerekli" };
    }

    const raw = (req as FastifyRequestWithRawBody).rawBody;
    if (!raw || raw.length === 0) {
      reply.code(403);
      return { error: "FORBIDDEN", message: "Ham gövde eksik" };
    }

    const bodySha256 = sha256HexBuffer(raw);
    const claim = await claimQaWebhookJob(body.jobId, bodySha256);

    if (claim.kind === "duplicate") {
      return {
        ok: true as const,
        duplicate: true as const,
        jobId: body.jobId,
      };
    }
    if (claim.kind === "conflict") {
      reply.code(409);
      return {
        error: "IDEMPOTENCY_CONFLICT" as const,
        message: "Aynı jobId farklı gövde ile daha önce işlendi",
      };
    }
    if (claim.kind === "in_flight") {
      reply.code(503);
      return {
        error: "QA_WEBHOOK_IN_FLIGHT" as const,
        message: "Bu jobId için işlem devam ediyor; kısa süre sonra yeniden deneyin",
        jobId: body.jobId,
      };
    }

    const adapter =
      (typeof body.adapterDbId === "string" && body.adapterDbId
        ? await prisma.adapter.findUnique({ where: { id: body.adapterDbId } })
        : null) ??
      (await prisma.adapter.findFirst({
        where: {
          OR: [{ weightsCid: body.adapterCid }, { manifestCid: body.adapterCid }],
        },
        orderBy: { createdAt: "desc" },
      }));
    if (!adapter) {
      await releaseQaWebhookClaim(body.jobId);
      reply.code(404);
      return { error: "NOT_FOUND", message: "CID için adapter bulunamadı" };
    }

    const approved = body.status === "approved";
    let reasonCode = 2;
    const m = body.metrics;
    if (m && typeof m === "object" && "reasonCode" in m) {
      const rc = (m as { reasonCode?: unknown }).reasonCode;
      if (typeof rc === "number") reasonCode = rc;
    }

    const pkg = getPublishedPackageId();
    const adminCap =
      process.env.R3MES_REGISTRY_ADMIN_CAP_OBJECT_ID?.trim() ??
      R3MES_TESTNET_MOCK_REGISTRY_ADMIN_CAP_OBJECT_ID;
    const canChain =
      Boolean(adapter.onChainObjectId && adapter.onChainAdapterId !== null) &&
      Boolean(pkg && getOperatorKeypair() && adminCap);

    try {
      if (canChain) {
        try {
          await applyQaResultOnChain({
            approved,
            adapterObjectId: adapter.onChainObjectId as string,
            onChainAdapterId: adapter.onChainAdapterId as bigint,
            rejectReasonCode: reasonCode,
          });
        } catch (e) {
          await releaseQaWebhookClaim(body.jobId);
          reply.code(500);
          return {
            error: "ONCHAIN_QA_FAILED",
            message: e instanceof Error ? e.message : String(e),
          };
        }
      }

      const updated = await prisma.adapter.update({
        where: { id: adapter.id },
        data: {
          benchmarkScore: new Prisma.Decimal(body.score),
          status: approved ? AdapterStatus.ACTIVE : AdapterStatus.REJECTED,
        },
      });

      req.log.info({
        e2eLifecycle: "qa_webhook_applied",
        adapterId: adapter.id,
        jobId: body.jobId,
        newStatus: updated.status,
        onChainApplied: canChain,
      });

      await completeQaWebhookJob(body.jobId);
    } catch (e) {
      await releaseQaWebhookClaim(body.jobId);
      throw e;
    }

    return {
      ok: true as const,
      adapterId: adapter.id,
      onChainApplied: canChain,
      duplicate: false as const,
    };
  });
}
