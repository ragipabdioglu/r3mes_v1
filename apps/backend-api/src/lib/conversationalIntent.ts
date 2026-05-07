export type ConversationalIntentKind = "greeting" | "thanks" | "farewell" | "usage_help";

export interface ConversationalIntentDecision {
  kind: ConversationalIntentKind;
  confidence: "high" | "medium";
  reason: string;
  response: string;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}\s?!.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const KNOWLEDGE_SEEKING_TERMS = [
  "agri",
  "agriyor",
  "agrim",
  "neden",
  "nasil",
  "ne yap",
  "ne olur",
  "sonuc",
  "rapor",
  "dava",
  "itiraz",
  "migration",
  "veritabani",
  "yatirim",
  "smear",
  "kanama",
  "ates",
  "belge",
  "kaynak",
];

function looksKnowledgeSeeking(normalized: string): boolean {
  return KNOWLEDGE_SEEKING_TERMS.some((term) => normalized.includes(term));
}

function isOnlyShortSocialText(normalized: string): boolean {
  const parts = tokens(normalized);
  return parts.length > 0 && parts.length <= 5 && !looksKnowledgeSeeking(normalized);
}

export function detectConversationalIntent(query: string): ConversationalIntentDecision | null {
  const normalized = normalize(query);
  if (!normalized) return null;

  if (/\b(bu sistemi nasil kullanirim|nasil kullanilir|nasil kullanacagim|yardim|ne yapabiliyorsun)\b/u.test(normalized)) {
    return {
      kind: "usage_help",
      confidence: "high",
      reason: "platform usage/help intent",
      response:
        "R3MES'e bir konu veya belge kaynağı seçip soru sorabilirsin. İstersen önce knowledge yükleyip sonra o kaynakla konuş; kaynak yoksa genel sohbet yerine kaynak seçmeni önerebilirim.",
    };
  }

  if (!isOnlyShortSocialText(normalized)) return null;

  if (/^(merhaba|selam|sa|slm|hey|hello|hi)(lar)?[!. ]*$/u.test(normalized)) {
    return {
      kind: "greeting",
      confidence: "high",
      reason: "short greeting",
      response:
        "Merhaba. Buradayım; istersen bir knowledge kaynağı seçip soru sorabilir ya da yeni bir belge yükleyerek onun üzerinden konuşabiliriz.",
    };
  }

  if (/^(tesekkurler|tesekkur ederim|sag ol|sagol|eyvallah|tamam tesekkurler)[!. ]*$/u.test(normalized)) {
    return {
      kind: "thanks",
      confidence: "high",
      reason: "short thanks",
      response: "Rica ederim. Yeni bir soru sormak istersen buradayım.",
    };
  }

  if (/^(gorusuruz|hadi gorusuruz|bye|iyi gunler|iyi geceler)[!. ]*$/u.test(normalized)) {
    return {
      kind: "farewell",
      confidence: "high",
      reason: "short farewell",
      response: "Görüşürüz. Devam etmek istediğinde buradayım.",
    };
  }

  return null;
}
