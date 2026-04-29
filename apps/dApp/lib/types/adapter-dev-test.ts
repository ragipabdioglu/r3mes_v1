import type { AdapterListItem } from "@/lib/types/adapter";
import { R3MES_DEV_TEST_DOMAIN_TAG } from "@/lib/ui/r3mes-fe-contract";

/** Eski backend sürümü — yerel DB’de kalan kayıtlar için */
const LEGACY_DEV_BYPASS_QA_TAG = "dev_bypass_qa";

function devTestAdapterIdsFromEnv(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_R3MES_DEV_TEST_ADAPTER_IDS?.trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function hasDevTestDomainTag(tags: string[] | undefined): boolean {
  if (!tags?.length) return false;
  if (tags.includes(R3MES_DEV_TEST_DOMAIN_TAG)) return true;
  return tags.includes(LEGACY_DEV_BYPASS_QA_TAG);
}

/** Dev bypass / QA test kaydı — gerçek benchmark onayı anlamına gelmez. */
export function isDevTestAdapter(
  a: Pick<AdapterListItem, "id" | "domainTags">,
): boolean {
  if (hasDevTestDomainTag(a.domainTags)) return true;
  return devTestAdapterIdsFromEnv().has(a.id);
}
