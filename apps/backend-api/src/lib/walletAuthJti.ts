import { Prisma } from "@prisma/client";

import { prisma } from "./prisma.js";

/** jti: UUID veya yüksek entropili dize (ör. 8–128 karakter) */
const JTI_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

export function isValidJtiFormat(jti: string): boolean {
  return JTI_PATTERN.test(jti);
}

/**
 * İlk başarılı kullanımda satır oluşturur. Aynı jti tekrar gelirse P2002 → replay.
 */
export async function consumeWalletAuthJti(jti: string, expiresAt: Date): Promise<"ok" | "replay"> {
  try {
    await prisma.walletAuthJti.create({
      data: { jti, expiresAt },
    });
    return "ok";
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return "replay";
    }
    throw e;
  }
}
