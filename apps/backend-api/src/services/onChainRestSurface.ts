import {
  type NotImplementedOnChainRestResponse,
  safeParseNotImplementedOnChainRestResponse,
} from "@r3mes/shared-types";

/**
 * POST stake / POST rewards claim için sunucu tarafı REST yüzeyi.
 *
 * **Faz 5 (ORTAK §3.6):** `ON_CHAIN_REST_SURFACE_POLICY_FAZ5` = **bilinçli koru (501)** — backlog değil;
 * sunucu zincir davranışı simüle etmez. Gelecekte implement veya uç kaldırma: INTEGRATION_CONTRACT + semver.
 *
 * **BLOCKCHAIN** sunucu köprülü akışı netleştirirse: bu modüldeki `notImplemented*` yerine domain servisleri;
 * route dosyaları HTTP + auth tutar.
 *
 * Çıkış gövdeleri `NotImplementedOnChainRestResponseSchema` ile doğrulanır (ORTAK).
 */
export const ON_CHAIN_REST_READINESS = {
  stakePost: "not_implemented" as const,
  rewardsClaimPost: "not_implemented" as const,
} as const;

/** Faz 5 ürün kararı — `docs/api/INTEGRATION_CONTRACT.md` §3.6 ile aynı kaynak. */
export const ON_CHAIN_REST_SURFACE_POLICY_FAZ5 = {
  "POST /v1/stake": "conscious_keep_501" as const,
  "POST /v1/user/:wallet/rewards/claim": "conscious_keep_501" as const,
} as const;

function finalizeNotImplementedBody(
  body: NotImplementedOnChainRestResponse,
): NotImplementedOnChainRestResponse {
  const p = safeParseNotImplementedOnChainRestResponse(body);
  if (!p.success) {
    throw new Error(`NOT_IMPLEMENTED body drift from schema: ${p.error.message}`);
  }
  return p.data;
}

export function notImplementedStakePost(): NotImplementedOnChainRestResponse {
  return finalizeNotImplementedBody({
    success: false,
    code: "NOT_IMPLEMENTED",
    message:
      "Stake Sui cüzdanı üzerinden Move ile yapılır; sunucu bu uçta işlem yürütmez (501 bilinçli yüzey).",
    surface: "POST /v1/stake",
  });
}

export function notImplementedRewardsClaimPost(): NotImplementedOnChainRestResponse {
  return finalizeNotImplementedBody({
    success: false,
    code: "NOT_IMPLEMENTED",
    message:
      "Ödül talebi sunucu üzerinden yürütülmez; Sui Move / havuz akışları kullanılır (501 bilinçli yüzey).",
    surface: "POST /v1/user/:wallet/rewards/claim",
  });
}
