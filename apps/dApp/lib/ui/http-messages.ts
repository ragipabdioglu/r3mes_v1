/**
 * Kullanıcıya gösterilecek kısa mesajlar — backend gövdesindeki `message` / `code` ile uyumlu.
 * Yeni alan uydurulmaz; yalnızca mevcut JSON okunur.
 */

export type HttpMessageContext = "generic" | "stake" | "chat" | "upload";

export function messageFromResponseBody(text: string): {
  message: string | null;
  code: string | null;
} {
  try {
    const j = JSON.parse(text) as { message?: unknown; code?: unknown; error?: unknown };
    const message =
      typeof j.message === "string" && j.message.length > 0 ? j.message : null;
    const code =
      typeof j.code === "string" && j.code.length > 0
        ? j.code
        : typeof j.error === "string" && j.error.length > 0
          ? j.error
          : null;
    return { message, code };
  } catch {
    return { message: null, code: null };
  }
}

function notImplementedHint(context: HttpMessageContext, detail: string): string {
  switch (context) {
    case "stake":
      return `${detail} Stake ve ödül işlemleri zincir üzerinden (Move / cüzdan) yapılır.`;
    case "chat":
      return `${detail} Sohbet için API’nin erişilebilir olduğundan ve cüzdan oturumunun geçerli olduğundan emin olun.`;
    case "upload":
      return `${detail} Dosya biçimi ve oturum gereksinimlerini kontrol edin.`;
    default:
      return `${detail} Bu kanalda tamamlanmıyorsa güncelleme veya yönlendirme bilgisini takip edin.`;
  }
}

/**
 * Toast / satır içi: 501 ve NOT_IMPLEMENTED için bağlama göre net ürün dili.
 */
export function userFacingHttpMessage(
  status: number,
  bodyText: string,
  context: HttpMessageContext = "generic",
): string {
  const { message, code } = messageFromResponseBody(bodyText);
  const notImplemented = status === 501 || code === "NOT_IMPLEMENTED";

  if (notImplemented) {
    const detail =
      message ?? "Bu işlem henüz bu API üzerinden sunulmuyor.";
    return notImplementedHint(context, detail);
  }

  if (message) return message;
  if (bodyText.trim()) return bodyText.trim();
  return "İstek tamamlanamadı. Bir süre sonra yeniden deneyin.";
}

/** 501 veya gövdede NOT_IMPLEMENTED — beklenebilir “henüz yok” senaryosu. */
export function isNotImplementedResponse(
  status: number,
  bodyText: string,
): boolean {
  if (status === 501) return true;
  const { code } = messageFromResponseBody(bodyText);
  return code === "NOT_IMPLEMENTED";
}

export type FetchFailureKind =
  | "stake"
  | "rewards"
  | "marketplace"
  | "studio";

/** GET / liste hataları — kısa, tutarlı ürün dili. */
export function userFacingFetchFailure(kind: FetchFailureKind): string {
  switch (kind) {
    case "stake":
      return "Stake özeti yüklenemedi. Bağlantıyı ve cüzdan adresini kontrol edin.";
    case "rewards":
      return "Ödül özeti yüklenemedi. Bağlantıyı kontrol edin; sorun sürerse zincir sorgusunu doğrulayın.";
    case "marketplace":
      return "Model listesi yüklenemedi. Ağ ve API adresini kontrol edin.";
    case "studio":
      return "Adaptör listesi yüklenemedi. Ağ ve API adresini kontrol edin.";
  }
}

/** Ağ / istisna — mutation catch bloklarında aynı ton. */
export function userFacingMutationFailure(
  kind: "stake" | "claim" | "upload",
): string {
  switch (kind) {
    case "stake":
      return "Stake isteği gönderilemedi. Bağlantıyı kontrol edip yeniden deneyin.";
    case "claim":
      return "Ödül talebi gönderilemedi. Bağlantıyı kontrol edip yeniden deneyin.";
    case "upload":
      return "Yükleme gönderilemedi. Bağlantıyı kontrol edip yeniden deneyin.";
  }
}
