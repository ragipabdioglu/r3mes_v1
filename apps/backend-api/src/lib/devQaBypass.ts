/**
 * Yerel geliştirme: benchmark/QA kuyruğunu atlayıp upload sonrası ACTIVE (marketplace + chat dumanı).
 * Üretim veya staging'de asla açılmaz.
 */
const BYPASS_JOB_ID_SENTINEL = "dev-bypass-qa";

export function getDevBypassBenchmarkJobIdSentinel(): string {
  return BYPASS_JOB_ID_SENTINEL;
}

/**
 * domainTags içinde işaret — liste API'de görünür.
 * dApp `R3MES_DEV_TEST_DOMAIN_TAG` (`r3mes-fe-contract`) ile birebir aynı olmalı.
 */
export const DEV_BYPASS_QA_DOMAIN_TAG = "r3mes:dev-test";

export function isDevQaBypassEnabled(): boolean {
  if (process.env.R3MES_DEV_BYPASS_QA !== "1") return false;
  const nodeEnv = process.env.NODE_ENV ?? "development";
  if (nodeEnv === "production") return false;
  return nodeEnv === "development" || nodeEnv === "test";
}
