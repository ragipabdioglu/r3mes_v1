import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { prisma } from "../lib/prisma.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok" as const }));

  app.get("/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
      await redis.ping();
      redis.disconnect();
      return { status: "ready" as const };
    } catch (err) {
      reply.code(503);
      return {
        status: "unavailable" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  app.get("/v1/version", async () => ({
    service: "r3mes-backend-api",
    version: "0.1.0",
  }));
}
