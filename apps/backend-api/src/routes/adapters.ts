import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { AdapterArtifactFormat, AdapterKind, AdapterRuntime, AdapterStatus } from "@prisma/client";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  type LoRAUploadAcceptedResponse,
  LoRAUploadAcceptedResponseSchema,
  safeParseAdapterListResponse,
} from "@r3mes/shared-types";
import { enqueueBenchmarkJob } from "../jobProducer.js";
import { toAdapterListItem } from "../lib/adapterDto.js";
import { sendApiError } from "../lib/apiErrors.js";
import {
  DEV_BYPASS_QA_DOMAIN_TAG,
  getDevBypassBenchmarkJobIdSentinel,
  isDevQaBypassEnabled,
} from "../lib/devQaBypass.js";
import { validatePrimerGgufWeights } from "../lib/ggufWeightsValidate.js";
import { ipfsAddBuffer } from "../lib/ipfsAdd.js";
import { prisma } from "../lib/prisma.js";
import { walletAuthPreHandler } from "../lib/walletAuth.js";

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = raw ? Number.parseInt(raw, 10) : fallback;
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}

const adapterStatuses = new Set<string>(Object.values(AdapterStatus));
const STALE_PENDING_REVIEW_MS = 24 * 60 * 60 * 1000;

function isStalePendingReviewAdapter(
  adapter: {
    status: AdapterStatus;
    benchmarkScore: Prisma.Decimal | null;
    domainTags: string[];
    createdAt: Date;
  },
  nowMs: number,
): boolean {
  if (adapter.status !== AdapterStatus.PENDING_REVIEW) return false;
  if (adapter.benchmarkScore != null) return false;
  if (adapter.domainTags.length > 0) return false;
  return nowMs - adapter.createdAt.getTime() > STALE_PENDING_REVIEW_MS;
}

export async function registerAdapterRoutes(app: FastifyInstance) {
  const listAdaptersHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
    ownerWallet: string | null,
    hideStalePending = false,
  ) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = parseLimit(q.limit, 20, 100);
    const status = q.status;
    const cursor = q.cursor;
    const nowMs = Date.now();

    const where: Prisma.AdapterWhereInput = {};
    if (ownerWallet) {
      where.owner = { walletAddress: ownerWallet };
    }
    if (status && status !== "all" && adapterStatuses.has(status)) {
      where.status = status as AdapterStatus;
    }

    const items = await prisma.adapter.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { walletAddress: true, displayName: true } },
      },
    });

    let nextCursor: string | null = null;
    let list = items;
    if (items.length > limit) {
      const next = items.pop();
      nextCursor = next?.id ?? null;
      list = items;
    }

    if (hideStalePending) {
      list = list.filter((adapter) => !isStalePendingReviewAdapter(adapter, nowMs));
    }

    const data = list.map(toAdapterListItem);

    const payload = { data, nextCursor };
    const parsed = safeParseAdapterListResponse(payload);
    if (!parsed.success) {
      req.log.error({ issues: parsed.error.flatten() }, "AdapterListResponse contract violation");
      return sendApiError(
        reply,
        500,
        "CONTRACT_INVARIANT_VIOLATION",
        "Adapter list response failed contract validation",
      );
    }
    return parsed.data;
  };

  const listAdapters = async (req: FastifyRequest, reply: FastifyReply) =>
    listAdaptersHandler(req, reply, null);

  const listMyAdapters = async (req: FastifyRequest, reply: FastifyReply) => {
    const w = req.verifiedWalletAddress;
    if (!w) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    return listAdaptersHandler(req, reply, w, true);
  };

  app.get("/v1/adapters", listAdapters);
  app.get("/adapters", listAdapters);
  app.get("/v1/me/adapters", { preHandler: walletAuthPreHandler }, listMyAdapters);

  app.get("/v1/adapters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = await prisma.adapter.findUnique({
      where: { id },
      include: {
        owner: { select: { walletAddress: true, displayName: true } },
      },
    });
    if (!a) {
      return sendApiError(reply, 404, "NOT_FOUND", "Adapter not found");
    }
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      status: a.status,
      kind: a.kind,
      format: a.format,
      runtime: a.runtime,
      baseModel: a.baseModel,
      storagePath: a.storagePath,
      onChainAdapterId: a.onChainAdapterId?.toString() ?? null,
      onChainObjectId: a.onChainObjectId,
      weightsCid: a.weightsCid,
      manifestCid: a.manifestCid,
      benchmarkScore: a.benchmarkScore != null ? Number(a.benchmarkScore) : null,
      domainTags: a.domainTags,
      ownerWallet: a.owner.walletAddress,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  });

  app.get("/v1/chain/adapters/:onChainId", async (req, reply) => {
    const { onChainId } = req.params as { onChainId: string };
    let big: bigint;
    try {
      big = BigInt(onChainId);
    } catch {
      return sendApiError(reply, 400, "INVALID_ID", "onChainId must be a numeric string");
    }
    const a = await prisma.adapter.findFirst({
      where: { onChainAdapterId: big },
      include: {
        owner: { select: { walletAddress: true } },
      },
    });
    if (!a) {
      return sendApiError(reply, 404, "NOT_FOUND", "Adapter not indexed");
    }
    return {
      id: a.id,
      onChainAdapterId: a.onChainAdapterId?.toString() ?? null,
      onChainObjectId: a.onChainObjectId,
      status: a.status,
      format: a.format,
      runtime: a.runtime,
      baseModel: a.baseModel,
      storagePath: a.storagePath,
      ownerWallet: a.owner.walletAddress,
    };
  });

  const registerLocalBehaviorAdapter = async (req: FastifyRequest, reply: FastifyReply) => {
    const verified = req.verifiedWalletAddress;
    if (!verified) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const baseModel =
      typeof body.baseModel === "string" && body.baseModel.trim().length > 0 ? body.baseModel.trim() : "qwen2.5-3b";

    if (!name) {
      return sendApiError(reply, 400, "NAME_REQUIRED", "Behavior adapter adı gerekli");
    }
    if (!storagePath) {
      return sendApiError(reply, 400, "STORAGE_PATH_REQUIRED", "Yerel adapter storagePath gerekli");
    }

    const user = await prisma.user.upsert({
      where: { walletAddress: verified },
      create: { walletAddress: verified },
      update: {},
    });

    const adapter = await prisma.adapter.create({
      data: {
        ownerId: user.id,
        name,
        description,
        kind: AdapterKind.LORA,
        format: AdapterArtifactFormat.PEFT,
        runtime: AdapterRuntime.TRANSFORMERS,
        baseModel,
        storagePath,
        status: AdapterStatus.ACTIVE,
        benchmarkScore: null,
        domainTags: ["r3mes:behavior", "r3mes:local-path"],
      },
    });

    reply.code(201);
    return {
      id: adapter.id,
      name: adapter.name,
      status: adapter.status,
      format: adapter.format,
      runtime: adapter.runtime,
      baseModel: adapter.baseModel,
      storagePath: adapter.storagePath,
      createdAt: adapter.createdAt.toISOString(),
    };
  };

  const postMultipartAdapter = async (req: FastifyRequest, reply: FastifyReply) => {
    const ipfsApi = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";
    let displayName: string | undefined;
    let walletRaw: string | undefined;
    const weightFiles: { name: string; buf: Buffer }[] = [];
    let manifestBuf: Buffer | null = null;
    let manifestName = "manifest.json";

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        const fn = part.fieldname;
        if (fn === "manifest") {
          manifestBuf = buf;
          manifestName = part.filename || manifestName;
        } else if (fn === "weights") {
          weightFiles.push({ name: part.filename || "weights.gguf", buf });
        }
      } else if (part.type === "field") {
        if (part.fieldname === "displayName") {
          const v = String(part.value ?? "").trim();
          displayName = v || undefined;
        }
        if (part.fieldname === "wallet") {
          const v = String(part.value ?? "").trim();
          walletRaw = v || undefined;
        }
      }
    }

    const verified = req.verifiedWalletAddress;
    if (!verified) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Cüzdan doğrulaması gerekli");
    }
    if (walletRaw) {
      try {
        if (normalizeSuiAddress(walletRaw) !== verified) {
          return sendApiError(
            reply,
            403,
            "WALLET_MISMATCH",
            "wallet alanı imzalı X-Wallet-Address ile aynı olmalıdır",
          );
        }
      } catch {
        return sendApiError(reply, 400, "INVALID_WALLET", "Geçersiz Sui adresi (wallet alanı)");
      }
    }
    const wallet = verified;

    if (weightFiles.length === 0) {
      return sendApiError(
        reply,
        400,
        "WEIGHTS_REQUIRED",
        "En az bir weights dosyası gerekli (içerik: llama.cpp uyumlu LoRA GGUF; sunucuda dönüşüm yok)",
      );
    }
    if (weightFiles.length > 1) {
      return sendApiError(
        reply,
        400,
        "MULTIPLE_WEIGHTS_NOT_ALLOWED",
        "Tek primer GGUF artefact: yalnızca bir weights dosyası gönderin (formda weights alanı tekrarlanamaz)",
      );
    }

    const primary = weightFiles[0]!;
    const gguf = validatePrimerGgufWeights(primary.buf, primary.name);
    if (!gguf.ok) {
      const r = gguf.reject;
      return sendApiError(reply, 400, r.error, r.message);
    }

    let manifestCid: string | null = null;
    if (manifestBuf) {
      manifestCid = await ipfsAddBuffer(ipfsApi, manifestBuf, manifestName);
    }
    const weightsCid = await ipfsAddBuffer(ipfsApi, primary.buf, primary.name);

    const user = await prisma.user.upsert({
      where: { walletAddress: wallet },
      create: { walletAddress: wallet, displayName: displayName ?? null },
      update: { ...(displayName ? { displayName } : {}) },
    });

    const adapterName =
      displayName && displayName.length > 0
        ? displayName
        : primary.name.replace(/\.(safetensors|gguf)$/i, "") || "LoRA";

    const devBypassQa = isDevQaBypassEnabled();

    const adapter = await prisma.adapter.create({
      data: {
        ownerId: user.id,
        name: adapterName,
        kind: AdapterKind.LORA,
        weightsCid,
        manifestCid,
        status: devBypassQa ? AdapterStatus.ACTIVE : AdapterStatus.PENDING_REVIEW,
        benchmarkScore: null,
        domainTags: devBypassQa ? [DEV_BYPASS_QA_DOMAIN_TAG] : [],
      },
    });

    const benchmarkJobId = devBypassQa
      ? getDevBypassBenchmarkJobIdSentinel()
      : await enqueueBenchmarkJob({
          adapterDbId: adapter.id,
          onChainAdapterId: adapter.onChainAdapterId?.toString() ?? "0",
          ipfsCid: weightsCid,
          ownerWallet: wallet,
        });

    const out: LoRAUploadAcceptedResponse = {
      adapterId: adapter.id,
      adapterDbId: adapter.id,
      weightsCid,
      manifestCid,
      benchmarkJobId,
      status: adapter.status,
      ...(devBypassQa ? { devQaBypassApplied: true as const } : {}),
    };
    const validated = LoRAUploadAcceptedResponseSchema.safeParse(out);
    if (!validated.success) {
      req.log.error({ issues: validated.error.flatten() }, "LoRA upload response contract violation");
      return sendApiError(
        reply,
        500,
        "CONTRACT_INVARIANT_VIOLATION",
        "Upload response failed contract validation",
      );
    }
    req.log.info({
      e2eLifecycle: devBypassQa ? "upload_accepted_dev_bypass_qa" : "upload_accepted",
      adapterDbId: adapter.id,
      weightsCid,
      benchmarkJobId,
      status: adapter.status,
      devBypassQa,
    });
    reply.code(201);
    return validated.data;
  };

  app.post("/v1/adapters", { preHandler: walletAuthPreHandler }, postMultipartAdapter);
  app.post("/adapters", { preHandler: walletAuthPreHandler }, postMultipartAdapter);
  app.post("/v1/adapters/register-local", { preHandler: walletAuthPreHandler }, registerLocalBehaviorAdapter);
}
