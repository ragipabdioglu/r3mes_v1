#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { SuiIndexer } from "./indexer.js";

/** Üretimde benchmark bypass bayrağının yanlışlıkla açılmasını engeller (backend `assertNoInsecureSkipFlagsInProduction` ile aynı ruh). */
function assertNoBenchmarkSkipInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SKIP_BENCHMARK_QUEUE === "1") {
    console.error(
      "[r3mes-sui-indexer] NODE_ENV=production iken SKIP_BENCHMARK_QUEUE kullanılamaz. Yerel profilde deneyin veya bayrağı kaldırın.",
    );
    process.exit(1);
  }
}

assertNoBenchmarkSkipInProduction();

const packageId = process.env.R3MES_PACKAGE_ID;
if (!packageId) {
  console.error("R3MES_PACKAGE_ID ortam değişkeni gerekli (yayımlanmış Move paket adresi).");
  process.exit(1);
}

const prisma = new PrismaClient();
const rpcUrl = process.env.SUI_RPC_URL ?? getFullnodeUrl("localnet");
const client = new SuiClient({ url: rpcUrl });

const useSubscribe = process.env.SUI_INDEXER_SUBSCRIBE === "1";

const indexer = new SuiIndexer(prisma, client, {
  packageId,
  pollIntervalMs: Number(process.env.SUI_INDEXER_POLL_MS ?? 2000),
  useSubscribe,
});

const shutdown = () => {
  indexer.requestStop();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[r3mes-sui-indexer] RPC=${rpcUrl} package=${packageId} subscribe=${useSubscribe}`);

await indexer.run();
await prisma.$disconnect();
