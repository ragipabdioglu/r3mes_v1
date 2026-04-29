import type { EventId, SuiClient } from "@mysten/sui/client";
import { normalizeSuiAddress } from "@mysten/sui/utils";

function eventType(packageId: string, module: string, name: string): string {
  return `${packageId}::${module}::${name}`;
}

function addrEq(a: string, b: string): boolean {
  try {
    return normalizeSuiAddress(a) === normalizeSuiAddress(b);
  } catch {
    return false;
  }
}

/**
 * Zincirdeki MoveEvent özetleri — paket yayınlandıktan sonra `R3MES_PACKAGE_ID` gerekir.
 */
export async function aggregateRewardTotals(
  client: SuiClient,
  packageId: string,
  wallet: string,
): Promise<{
  stakeWithdrawnBaseUnits: bigint;
  stakeSlashedBaseUnits: bigint;
  chatUsageFeesPaidMist: bigint;
  pagesScanned: number;
}> {
  const w = normalizeSuiAddress(wallet);
  let stakeWithdrawnBaseUnits = 0n;
  let stakeSlashedBaseUnits = 0n;
  let chatUsageFeesPaidMist = 0n;
  let pages = 0;

  const withdrawType = eventType(packageId, "staking_pool", "StakeWithdrawnEvent");
  const slashType = eventType(packageId, "staking_pool", "StakeSlashedEvent");
  const usageType = eventType(packageId, "reward_pool", "UsageRecordedEvent");

  async function scanMoveEventType(moveType: string, onRow: (p: Record<string, unknown>) => void) {
    let cursor: EventId | null | undefined;
    for (let i = 0; i < 25; i++) {
      pages += 1;
      const res = await client.queryEvents({
        query: { MoveEventType: moveType },
        cursor,
        limit: 50,
        order: "descending",
      });
      for (const ev of res.data) {
        const parsed = ev.parsedJson as Record<string, unknown>;
        onRow(parsed);
      }
      if (!res.hasNextPage) break;
      cursor = res.nextCursor ?? undefined;
      if (!cursor) break;
    }
  }

  await scanMoveEventType(withdrawType, (p) => {
    const trainer = typeof p.trainer === "string" ? p.trainer : "";
    if (addrEq(trainer, w)) {
      stakeWithdrawnBaseUnits += BigInt(String(p.amount ?? 0));
    }
  });

  await scanMoveEventType(slashType, (p) => {
    const trainer = typeof p.trainer === "string" ? p.trainer : "";
    if (addrEq(trainer, w)) {
      stakeSlashedBaseUnits += BigInt(String(p.amount ?? 0));
    }
  });

  await scanMoveEventType(usageType, (p) => {
    const user = typeof p.user === "string" ? p.user : "";
    const amt = BigInt(String(p.amount_mist ?? 0));
    if (addrEq(user, w)) {
      chatUsageFeesPaidMist += amt;
    }
  });

  return {
    stakeWithdrawnBaseUnits,
    stakeSlashedBaseUnits,
    chatUsageFeesPaidMist,
    pagesScanned: pages,
  };
}
