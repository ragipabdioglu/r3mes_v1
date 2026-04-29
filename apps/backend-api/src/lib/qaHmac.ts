import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export type FastifyRequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

/** Sondaki `/` veya query; Fastify route eşleşse bile `raw.url` bazen `/v1/internal/qa-result/` olabilir. */
export function isQaResultWebhookPath(rawUrl: string | undefined): boolean {
  const pathOnly = (rawUrl ?? "").split("?")[0] ?? "";
  const base = pathOnly.replace(/\/+$/, "") || "/";
  return base === "/v1/internal/qa-result";
}

/**
 * Yalnızca POST /v1/internal/qa-result için ham gövdeyi bufferlar (HMAC doğrulaması için).
 */
export function registerQaWebhookRawBodyCapture(app: FastifyInstance): void {
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.method !== "POST" || !isQaResultWebhookPath(request.raw.url)) {
      return payload;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks);
    (request as FastifyRequestWithRawBody).rawBody = raw;
    return Readable.from(raw);
  });
}

/**
 * `X-QA-HMAC`: ham gövde üzerinde HMAC-SHA256 (hex), `R3MES_QA_WEBHOOK_SECRET` ile uyumlu olmalı.
 */
export async function qaHmacPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = process.env.R3MES_QA_WEBHOOK_SECRET?.trim();
  if (!secret) {
    reply.code(403);
    void reply.send({ error: "FORBIDDEN", message: "R3MES_QA_WEBHOOK_SECRET yapılandırılmamış" });
    return;
  }

  const raw = (req as FastifyRequestWithRawBody).rawBody;
  if (!raw || raw.length === 0) {
    reply.code(403);
    void reply.send({ error: "FORBIDDEN", message: "Ham gövde eksik" });
    return;
  }

  const provided = req.headers["x-qa-hmac"];
  const headerVal =
    typeof provided === "string"
      ? provided.trim()
      : Array.isArray(provided)
        ? provided[0]?.trim() ?? ""
        : "";

  if (!headerVal) {
    reply.code(403);
    void reply.send({ error: "FORBIDDEN", message: "X-QA-HMAC başlığı zorunlu" });
    return;
  }

  const expectedHex = createHmac("sha256", secret).update(raw).digest("hex");

  try {
    const a = Buffer.from(headerVal, "hex");
    const b = Buffer.from(expectedHex, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      reply.code(403);
      void reply.send({ error: "FORBIDDEN", message: "Geçersiz HMAC" });
      return;
    }
  } catch {
    reply.code(403);
    void reply.send({ error: "FORBIDDEN", message: "Geçersiz HMAC biçimi" });
    return;
  }
}
