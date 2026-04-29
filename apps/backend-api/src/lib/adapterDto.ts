import type { Prisma } from "@prisma/client";
import type { AdapterListItem } from "@r3mes/shared-types";

export type AdapterRowWithOwnerWallet = Prisma.AdapterGetPayload<{
  include: { owner: { select: { walletAddress: true } } };
}>;

/** Prisma adapter + owner satırından kanonik liste öğesine tek eşleme. */
export function toAdapterListItem(a: AdapterRowWithOwnerWallet): AdapterListItem {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    kind: a.kind,
    format: a.format,
    runtime: a.runtime,
    baseModel: a.baseModel,
    storagePath: a.storagePath,
    onChainAdapterId: a.onChainAdapterId?.toString() ?? null,
    onChainObjectId: a.onChainObjectId,
    ipfsCid: a.weightsCid ?? a.manifestCid,
    benchmarkScore: a.benchmarkScore != null ? Number(a.benchmarkScore) : null,
    domainTags: a.domainTags,
    ownerWallet: a.owner.walletAddress,
    createdAt: a.createdAt.toISOString(),
  };
}
