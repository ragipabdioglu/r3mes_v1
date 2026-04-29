import type { PrismaClient } from "@prisma/client";
import { AdapterStatus } from "@prisma/client";
import type { SuiEvent } from "@mysten/sui/client";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { enqueueBenchmarkJob } from "@r3mes/backend-api/jobProducer";

function u64ToBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  throw new Error(`Expected u64-compatible value, got ${typeof v}`);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  throw new Error("Expected object parsedJson");
}

/**
 * Tek bir Sui olayını Prisma read modeline yazar.
 */
export async function handleSuiEvent(prisma: PrismaClient, event: SuiEvent): Promise<void> {
  const t = event.type;
  const tail = t.split("::").pop() ?? "";

  if (tail === "AdapterUploadedEvent") {
    await onAdapterUploaded(prisma, asRecord(event.parsedJson));
    return;
  }
  if (tail === "AdapterApprovedEvent") {
    await onAdapterApproved(prisma, asRecord(event.parsedJson));
    return;
  }
  if (tail === "AdapterRejectedEvent") {
    await onAdapterRejected(prisma, asRecord(event.parsedJson));
    return;
  }
  if (tail === "StakeDepositedEvent") {
    await onStakeDeposited(prisma, asRecord(event.parsedJson));
    return;
  }
  if (tail === "StakeWithdrawnEvent") {
    await onStakeWithdrawn(prisma, asRecord(event.parsedJson));
    return;
  }
  if (tail === "StakeSlashedEvent") {
    await onStakeSlashed(prisma, asRecord(event.parsedJson));
    return;
  }
}

async function onAdapterUploaded(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  const objectId = String(j.object_id);
  const creatorRaw = String(j.creator);
  const ipfsCid = String(j.ipfs_cid);
  const creator = normalizeSuiAddress(creatorRaw);

  const user = await prisma.user.upsert({
    where: { walletAddress: creator },
    create: { walletAddress: creator },
    update: {},
  });

  const adapter = await prisma.adapter.upsert({
    where: { onChainAdapterId: adapterId },
    create: {
      ownerId: user.id,
      name: `LoRA #${adapterId.toString()}`,
      onChainAdapterId: adapterId,
      onChainObjectId: objectId,
      weightsCid: ipfsCid,
      status: AdapterStatus.PENDING_REVIEW,
    },
    update: {
      onChainObjectId: objectId,
      weightsCid: ipfsCid,
    },
  });

  if (process.env.SKIP_BENCHMARK_QUEUE === "1") {
    return;
  }
  try {
    await enqueueBenchmarkJob({
      adapterDbId: adapter.id,
      onChainAdapterId: adapterId.toString(),
      ipfsCid,
      ownerWallet: creator,
    });
  } catch (e) {
    console.error("[sui-indexer] enqueueBenchmarkJob failed:", e);
  }
}

async function onAdapterApproved(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  await prisma.adapter.updateMany({
    where: { onChainAdapterId: adapterId },
    data: { status: AdapterStatus.ACTIVE },
  });
}

async function onAdapterRejected(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  await prisma.adapter.updateMany({
    where: { onChainAdapterId: adapterId },
    data: { status: AdapterStatus.REJECTED },
  });
}

async function onStakeDeposited(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  const trainer = normalizeSuiAddress(String(j.trainer));
  const amount = u64ToBigInt(j.amount);
  const poolObjectId = String(j.pool_object_id);

  await prisma.stakePosition.upsert({
    where: { onChainAdapterId: adapterId },
    create: {
      trainerAddress: trainer,
      onChainAdapterId: adapterId,
      amountNano: amount,
      poolObjectId,
    },
    update: {
      amountNano: amount,
      poolObjectId,
      trainerAddress: trainer,
    },
  });
}

async function onStakeWithdrawn(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  await prisma.stakePosition.deleteMany({
    where: { onChainAdapterId: adapterId },
  });
}

async function onStakeSlashed(prisma: PrismaClient, j: Record<string, unknown>): Promise<void> {
  const adapterId = u64ToBigInt(j.adapter_id);
  await prisma.stakePosition.deleteMany({
    where: { onChainAdapterId: adapterId },
  });
}
