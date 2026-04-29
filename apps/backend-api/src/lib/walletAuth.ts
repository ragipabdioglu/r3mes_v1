import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { FastifyReply, FastifyRequest } from "fastify";

import { consumeWalletAuthJti, isValidJtiFormat } from "./walletAuthJti.js";

declare module "fastify" {
  interface FastifyRequest {
    /** `walletAuthPreHandler` sonrası güvenilir Sui adresi */
    verifiedWalletAddress?: string;
  }
}

/** İstemci ile uyumlu başlık adları (HTTP küçük harfe indirger) */
export const WALLET_AUTH_HEADER_SIGNATURE = "x-signature";
export const WALLET_AUTH_HEADER_MESSAGE = "x-message";
export const WALLET_AUTH_HEADER_WALLET = "x-wallet-address";

function getHeader(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return raw[0]?.trim();
  return undefined;
}

function shouldSkipWalletAuth(): boolean {
  return process.env.R3MES_SKIP_WALLET_AUTH === "1";
}

/**
 * İmzalanan mesajın ham baytları — cüzdan ile aynı olmalı (çoğunlukla UTF-8 metin).
 * İsteğe bağlı: `base64:` öneki ile ham bayt (ör. çok baytlı özel format).
 */
export function getSignedMessageBytes(raw: string): Uint8Array {
  if (raw.startsWith("base64:")) {
    return Uint8Array.from(Buffer.from(raw.slice("base64:".length), "base64"));
  }
  return new TextEncoder().encode(raw);
}

/**
 * Süre kontrolü için UTF-8 metin (base64: ise çözülmüş string).
 */
export function getMessageStringForParsing(raw: string): string {
  if (raw.startsWith("base64:")) {
    return Buffer.from(raw.slice("base64:".length), "base64").toString("utf8");
  }
  return raw;
}

export interface ParsedAuthTiming {
  expSec: number;
  iatSec: number | null;
}

/**
 * Mesajda zorunlu JSON: `{ "exp": <unix>, "iat"?: <unix> }` (saniye; ms ise normalize edilir).
 * İsteğe bağlı `"address"` — varsa X-Wallet-Address ile eşleşmeli.
 */
/**
 * İmzalı JSON içinde isteğe bağlı `jti` (tek kullanımlık kimlik). Üretimde `R3MES_REQUIRE_WALLET_JTI=1` ile zorunlu kılınabilir.
 */
export function parseOptionalJti(messageStr: string): string | null {
  const trimmed = getMessageStringForParsing(messageStr).trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const j = JSON.parse(trimmed) as { jti?: unknown };
    if (typeof j.jti === "string") {
      const v = j.jti.trim();
      return v.length > 0 ? v : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseAuthTiming(messageStr: string): ParsedAuthTiming | null {
  const trimmed = getMessageStringForParsing(messageStr).trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const j = JSON.parse(trimmed) as {
      exp?: unknown;
      iat?: unknown;
      address?: unknown;
    };
    if (typeof j.exp !== "number" || Number.isNaN(j.exp)) return null;
    const exp = j.exp > 1e12 ? Math.floor(j.exp / 1000) : Math.floor(j.exp);
    const iat =
      typeof j.iat === "number" && !Number.isNaN(j.iat)
        ? j.iat > 1e12
          ? Math.floor(j.iat / 1000)
          : Math.floor(j.iat)
        : null;
    return { expSec: exp, iatSec: iat };
  } catch {
    return null;
  }
}

function optionalAddressInMessage(messageStr: string): string | null | "invalid" {
  const trimmed = getMessageStringForParsing(messageStr).trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const j = JSON.parse(trimmed) as { address?: unknown };
    if (typeof j.address === "string" && j.address.length > 0) {
      try {
        return normalizeSuiAddress(j.address);
      } catch {
        return "invalid";
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function assertAuthTimingValid(
  timing: ParsedAuthTiming,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const skewSec = Number(process.env.R3MES_AUTH_CLOCK_SKEW_SEC ?? 120);
  const maxTtlSec = Number(process.env.R3MES_AUTH_MAX_TTL_SEC ?? 86400);
  const maxIatAgeSec = Number(process.env.R3MES_AUTH_MAX_IAT_AGE_SEC ?? 300);

  const nowSec = Math.floor(nowMs / 1000);

  if (timing.expSec < nowSec - skewSec) {
    return { ok: false, reason: "expired" };
  }
  if (timing.expSec > nowSec + maxTtlSec + skewSec) {
    return { ok: false, reason: "exp_too_far_in_future" };
  }

  if (timing.iatSec != null) {
    if (nowSec - timing.iatSec > maxIatAgeSec + skewSec) {
      return { ok: false, reason: "iat_too_old" };
    }
    if (timing.iatSec > nowSec + skewSec) {
      return { ok: false, reason: "iat_in_future" };
    }
  }

  return { ok: true };
}

function unauthorized(reply: FastifyReply, message: string, code: string = "UNAUTHORIZED") {
  reply.code(401);
  return reply.send({ error: code, message });
}

/**
 * POST istekleri için: X-Signature, X-Message, X-Wallet-Address doğrular.
 * Başarıda `req.verifiedWalletAddress` atanır.
 */
export async function walletAuthPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (shouldSkipWalletAuth()) {
    const dev = process.env.R3MES_DEV_WALLET?.trim();
    if (!dev) {
      void unauthorized(
        reply,
        "Yerel bypass için R3MES_DEV_WALLET ayarlayın (yalnızca R3MES_SKIP_WALLET_AUTH=1 ile)",
        "WALLET_AUTH_MISCONFIGURED",
      );
      return;
    }
    try {
      req.verifiedWalletAddress = normalizeSuiAddress(dev);
      return;
    } catch {
      void unauthorized(reply, "Geçersiz R3MES_DEV_WALLET");
      return;
    }
  }

  const signature = getHeader(req, WALLET_AUTH_HEADER_SIGNATURE);
  const messageRaw = getHeader(req, WALLET_AUTH_HEADER_MESSAGE);
  const walletRaw = getHeader(req, WALLET_AUTH_HEADER_WALLET);

  if (!signature || !messageRaw || !walletRaw) {
    void unauthorized(reply, "X-Signature, X-Message ve X-Wallet-Address başlıkları zorunludur");
    return;
  }

  let wallet: string;
  try {
    wallet = normalizeSuiAddress(walletRaw);
  } catch {
    void unauthorized(reply, "Geçersiz X-Wallet-Address");
    return;
  }

  const timing = parseAuthTiming(messageRaw);
  if (!timing) {
    void unauthorized(reply, 'X-Message geçerli JSON ve "exp" alanı içermelidir', "INVALID_MESSAGE_FORMAT");
    return;
  }

  const addrInMsg = optionalAddressInMessage(messageRaw);
  if (addrInMsg === "invalid") {
    void unauthorized(reply, "Mesajdaki address geçersiz", "INVALID_MESSAGE_ADDRESS");
    return;
  }
  if (addrInMsg && addrInMsg !== wallet) {
    void unauthorized(reply, "Mesajdaki address ile X-Wallet-Address eşleşmiyor", "ADDRESS_MISMATCH");
    return;
  }

  const timeCheck = assertAuthTimingValid(timing);
  if (!timeCheck.ok) {
    void unauthorized(
      reply,
      timeCheck.reason === "expired" ? "İmza süresi dolmuş (exp)" : "Geçersiz veya izin verilmeyen zaman damgası",
      "AUTH_EXPIRED",
    );
    return;
  }

  const messageBytes = getSignedMessageBytes(messageRaw);

  try {
    await verifyPersonalMessageSignature(messageBytes, signature, { address: wallet });
  } catch {
    void unauthorized(reply, "Geçersiz imza veya mesaj", "INVALID_SIGNATURE");
    return;
  }

  const jti = parseOptionalJti(messageRaw);
  const requireJti = process.env.R3MES_REQUIRE_WALLET_JTI === "1";

  // Tüketim yalnızca zorunlu modda: aksi halde önbelleğe alınmış aynı X-Message ile
  // art arda istekler (dApp cache) geçerli kalır.
  if (requireJti) {
    if (!jti) {
      void unauthorized(
        reply,
        'İmzalı JSON içinde "jti" (tek kullanımlık kimlik) zorunludur',
        "JTI_REQUIRED",
      );
      return;
    }
    if (!isValidJtiFormat(jti)) {
      void unauthorized(reply, "Geçersiz jti biçimi (8–128 karakter, güvenli ASCII alt kümesi)", "INVALID_JTI");
      return;
    }
    const expiresAt = new Date(timing.expSec * 1000);
    const consumed = await consumeWalletAuthJti(jti, expiresAt);
    if (consumed === "replay") {
      void unauthorized(reply, "jti daha önce kullanıldı (replay)", "JTI_REPLAY");
      return;
    }
  }

  req.verifiedWalletAddress = wallet;
}
