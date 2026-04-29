import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { registerAdapterRoutes } from "./routes/adapters.js";
import { registerChatProxyRoutes } from "./routes/chatProxy.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerInternalQaRoutes } from "./routes/internalQa.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerUserRoutes } from "./routes/user.js";

/**
 * Üretimde kimlik ve ücret korumalarının env ile kapatılmasını engeller.
 */
/**
 * Gerçek süreç girişi (`index.ts`) için: QA webhook HMAC olmadan backend çalıştırılmamalı.
 * Vitest `buildApp` doğrudan import eder; bu kontrol yalnızca index'te çağrılır.
 */
export function assertQaWebhookSecretConfigured(): void {
  const s = process.env.R3MES_QA_WEBHOOK_SECRET?.trim();
  if (!s) {
    throw new Error(
      "[R3MES] R3MES_QA_WEBHOOK_SECRET zorunludur (boş veya tanımsız). QA webhook HMAC doğrulaması için ayarlayın.",
    );
  }
}

/** Yerel + isteğe bağlı üretim origin (`R3MES_ALLOWED_ORIGIN`, virgülle çoklu). */
function buildAllowedCorsOrigins(): Set<string> {
  const allowed = new Set([
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
  const extra = process.env.R3MES_ALLOWED_ORIGIN?.trim();
  if (extra) {
    for (const part of extra.split(",")) {
      const o = part.trim();
      if (o) allowed.add(o);
    }
  }
  return allowed;
}

export function assertNoInsecureSkipFlagsInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  const skipWallet = process.env.R3MES_SKIP_WALLET_AUTH === "1";
  const skipFee = process.env.R3MES_SKIP_CHAT_FEE === "1";
  const devBypassQa = process.env.R3MES_DEV_BYPASS_QA === "1";
  if (skipWallet || skipFee) {
    throw new Error(
      "[R3MES] NODE_ENV=production iken R3MES_SKIP_WALLET_AUTH veya R3MES_SKIP_CHAT_FEE kullanılamaz. " +
        "Test/staging ortamında NODE_ENV ayırın veya bayrakları kaldırın.",
    );
  }
  if (devBypassQa) {
    throw new Error(
      "[R3MES] NODE_ENV=production iken R3MES_DEV_BYPASS_QA kullanılamaz (yalnızca development/test).",
    );
  }
}

export async function buildApp() {
  assertNoInsecureSkipFlagsInProduction();
  const app = Fastify({
    logger: true,
    bodyLimit: 524_288_000,
  });

  const allowedCorsOrigins = buildAllowedCorsOrigins();

  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && allowedCorsOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
    }
    reply.header("Access-Control-Expose-Headers", "x-r3mes-sources");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, X-Signature, X-Message, X-Wallet-Address, x-r3mes-wallet",
    );
    if (req.method === "OPTIONS") {
      reply.code(204);
      return reply.send();
    }
  });

  await app.register(multipart, {
    limits: { fileSize: 512 * 1024 * 1024 },
  });

  if (process.env.R3MES_DISABLE_RATE_LIMIT !== "1") {
    const max = Math.max(1, Number(process.env.R3MES_RATE_LIMIT_MAX ?? 100));
    const timeWindow = process.env.R3MES_RATE_LIMIT_WINDOW ?? "1 minute";
    await app.register((await import("@fastify/rate-limit")).default, {
      max,
      timeWindow,
    });
  }

  await registerHealthRoutes(app);
  await registerChatProxyRoutes(app);
  await registerAdapterRoutes(app);
  await registerKnowledgeRoutes(app);
  await registerInternalQaRoutes(app);
  await registerUserRoutes(app);

  return app;
}
