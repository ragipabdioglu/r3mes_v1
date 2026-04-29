import type { FastifyReply } from "fastify";

/**
 * Çoğu REST hata yanıtı: `error` (makine kodu) + `message` (insan okunur).
 * 501 stake/claim için `NotImplementedOnChainRestResponse` (shared-types) kullanılır.
 */
export type ApiErrorBody = { error: string; message: string };

export function apiError(error: string, message: string): ApiErrorBody {
  return { error, message };
}

export function sendApiError(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
): ApiErrorBody {
  reply.code(status);
  return apiError(error, message);
}
