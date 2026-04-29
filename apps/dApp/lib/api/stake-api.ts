import { getBackendUrl } from "@/lib/env";
import type { R3mesWalletAuthHeaders } from "@/lib/api/wallet-auth-types";

/** GET /v1/chain/stake/:wallet — backend read model */
export type StakeSummary = {
  wallet: string;
  totalStakedNano: string;
  positions: Array<{
    onChainAdapterId: string;
    amountNano: string;
    poolObjectId: string;
    updatedAt: string;
  }>;
};

/** GET /v1/user/:wallet/rewards — `source: "sui_events"` */
export type UserRewardsPayload = {
  wallet: string;
  source: "sui_events";
  stakeWithdrawnBaseUnits: string;
  stakeSlashedBaseUnits: string;
  chatUsageFeesPaidMist: string;
  eventPagesScanned: number;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export async function fetchStakeSummary(
  wallet: string,
): Promise<StakeSummary | null> {
  const base = getBackendUrl();
  const res = await fetch(
    `${base}/v1/chain/stake/${encodeURIComponent(wallet)}`,
    { cache: "no-store" },
  );
  const raw = parseJson(await res.text());
  if (!res.ok || !isRecord(raw) || "error" in raw) {
    return null;
  }
  if (
    typeof raw.wallet !== "string" ||
    typeof raw.totalStakedNano !== "string" ||
    !Array.isArray(raw.positions)
  ) {
    return null;
  }
  return raw as unknown as StakeSummary;
}

export async function fetchUserRewards(
  wallet: string,
): Promise<UserRewardsPayload | null> {
  const base = getBackendUrl();
  const res = await fetch(
    `${base}/v1/user/${encodeURIComponent(wallet)}/rewards`,
    { cache: "no-store" },
  );
  const raw = parseJson(await res.text());
  if (!res.ok || !isRecord(raw) || "error" in raw) {
    return null;
  }
  if (
    raw.source !== "sui_events" ||
    typeof raw.wallet !== "string" ||
    typeof raw.stakeWithdrawnBaseUnits !== "string" ||
    typeof raw.stakeSlashedBaseUnits !== "string" ||
    typeof raw.chatUsageFeesPaidMist !== "string" ||
    typeof raw.eventPagesScanned !== "number"
  ) {
    return null;
  }
  return raw as unknown as UserRewardsPayload;
}

export async function postStakeIntent(
  amount: string,
  auth: R3mesWalletAuthHeaders,
): Promise<Response> {
  const base = getBackendUrl();
  return fetch(`${base}/v1/stake`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": auth["X-Signature"],
      "X-Message": auth["X-Message"],
      "X-Wallet-Address": auth["X-Wallet-Address"],
    },
    body: JSON.stringify({ amount }),
  });
}

export async function postClaimRewards(
  wallet: string,
  auth: R3mesWalletAuthHeaders,
): Promise<Response> {
  const base = getBackendUrl();
  return fetch(
    `${base}/v1/user/${encodeURIComponent(wallet)}/rewards/claim`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": auth["X-Signature"],
        "X-Message": auth["X-Message"],
        "X-Wallet-Address": auth["X-Wallet-Address"],
      },
      body: JSON.stringify({}),
    },
  );
}
