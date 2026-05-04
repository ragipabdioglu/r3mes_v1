import {
  R3MES_TESTNET_MOCK_ADAPTER_REGISTRY_OBJECT_ID,
  R3MES_TESTNET_MOCK_COIN_TYPE,
  R3MES_TESTNET_MOCK_PACKAGE_ID,
  R3MES_TESTNET_MOCK_REWARD_POOL_OBJECT_ID,
  R3MES_TESTNET_MOCK_STAKING_POOL_OBJECT_ID,
  R3MES_TESTNET_MOCK_SUPPLY_STATE_OBJECT_ID,
} from "@r3mes/shared-types";

export function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

/**
 * Chat gövdesinde `model` yalnızca ayarlıysa gönderilir; yoksa backend / upstream varsayılanı.
 * AI motoru URL’si istemicide tutulmaz (proxy: POST /v1/chat/completions).
 */
export function getOptionalChatModel(): string | undefined {
  const m = process.env.NEXT_PUBLIC_CHAT_MODEL?.trim();
  return m || undefined;
}

/**
 * Resmi varsayılan çıkarım hattı için tek cümle ürün dili.
 * Boş bırakılırsa hiçbir ekranda runtime satırı gösterilmez.
 */
export function getOptionalInferenceRuntimePublicLine(): string | undefined {
  const s = process.env.NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT?.trim();
  return s || undefined;
}

export function getSuiNetwork(): "localnet" | "devnet" | "testnet" | "mainnet" {
  const n = process.env.NEXT_PUBLIC_SUI_NETWORK;
  if (
    n === "localnet" ||
    n === "devnet" ||
    n === "testnet" ||
    n === "mainnet"
  ) {
    return n;
  }
  return "testnet";
}

/** Tam Move coin tipi (`0x...::r3mes_coin::R3MES_COIN`). Env yoksa Faz 8.6 mock testnet değeri. */
export function getR3mesCoinType(): string {
  const t = process.env.NEXT_PUBLIC_R3MES_COIN_TYPE?.trim();
  return t || R3MES_TESTNET_MOCK_COIN_TYPE;
}

export function getR3mesPackageId(): string {
  return (
    process.env.NEXT_PUBLIC_R3MES_PACKAGE_ID?.trim() ||
    R3MES_TESTNET_MOCK_PACKAGE_ID
  );
}

/** Paylaşımlı `AdapterRegistry` nesne ID’si. */
export function getR3mesAdapterRegistryObjectId(): string {
  return (
    process.env.NEXT_PUBLIC_R3MES_ADAPTER_REGISTRY_OBJECT_ID?.trim() ||
    R3MES_TESTNET_MOCK_ADAPTER_REGISTRY_OBJECT_ID
  );
}

/** Ödül havuzu (backend `reward_pool` ile hizalı). */
export function getR3mesRewardPoolObjectId(): string {
  return (
    process.env.NEXT_PUBLIC_R3MES_REWARD_POOL_OBJECT_ID?.trim() ||
    R3MES_TESTNET_MOCK_REWARD_POOL_OBJECT_ID
  );
}

export function getR3mesStakingPoolObjectId(): string {
  return (
    process.env.NEXT_PUBLIC_R3MES_STAKING_POOL_OBJECT_ID?.trim() ||
    R3MES_TESTNET_MOCK_STAKING_POOL_OBJECT_ID
  );
}

export function getR3mesSupplyStateObjectId(): string {
  return (
    process.env.NEXT_PUBLIC_R3MES_SUPPLY_STATE_OBJECT_ID?.trim() ||
    R3MES_TESTNET_MOCK_SUPPLY_STATE_OBJECT_ID
  );
}

/** İmza önbelleği süresi (ms). Varsayılan 24 saat. */
export function getAuthTtlMs(): number {
  const raw = process.env.NEXT_PUBLIC_R3MES_AUTH_TTL_MS;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 86_400_000;
}

/** Backend `R3MES_REQUIRE_WALLET_JTI=1` ile aynı anda açılmalı; jti + önbellek devre dışı. */
export function getWalletAuthRequireJti(): boolean {
  return process.env.NEXT_PUBLIC_R3MES_REQUIRE_WALLET_JTI === "1";
}

export function getChatDebugEnabled(): boolean {
  return process.env.NEXT_PUBLIC_R3MES_CHAT_DEBUG === "1";
}
