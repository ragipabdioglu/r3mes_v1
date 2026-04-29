import { normalizeKnowledgeText } from "./knowledgeEmbedding.js";

export interface KnowledgeCard {
  topic: string;
  tags: string[];
  patientSummary: string;
  clinicalTakeaway: string;
  safeGuidance: string;
  redFlags: string;
  doNotInfer: string;
}

function extractField(content: string, label: string, endLabels: string[]): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const start = normalized.search(new RegExp(`^${label}\\s*:`, "im"));
  if (start === -1) return "";
  const afterStart = normalized.slice(start);
  const match = afterStart.match(new RegExp(`^${label}\\s*:\\s*`, "im"));
  const body = match ? afterStart.slice(match[0].length) : afterStart;
  let endIndex = body.length;
  for (const endLabel of endLabels) {
    const idx = body.search(new RegExp(`\\n\\s*${endLabel}\\s*:`, "i"));
    if (idx !== -1) {
      endIndex = Math.min(endIndex, idx);
    }
  }
  return body.slice(0, endIndex).trim();
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim()) return value.trim();
  }
  return "";
}

export function parseKnowledgeCard(content: string): KnowledgeCard {
  const topic = firstNonEmpty(
    extractField(content, "Topic", [
      "Tags",
      "Source Summary",
      "Key Takeaway",
      "Patient Summary",
      "Clinical Takeaway",
      "Safe Guidance",
      "Red Flags",
      "Do Not Infer",
    ]),
    extractField(content, "Başlık", [
      "Etiketler",
      "Hasta Özeti",
      "Temel Bilgi",
      "Triage",
      "Uyarı Bulguları",
      "Çıkarım Yapma",
    ]),
    extractField(content, "Yakınma", [
      "Temel Bilgi",
      "Triage",
      "Tags",
      "Source Summary",
      "Key Takeaway",
      "Patient Summary",
      "Clinical Takeaway",
      "Safe Guidance",
      "Red Flags",
      "Do Not Infer",
    ]),
  );

  const tagsRaw = firstNonEmpty(
    extractField(content, "Tags", [
      "Source Summary",
      "Key Takeaway",
      "Patient Summary",
      "Clinical Takeaway",
      "Safe Guidance",
      "Red Flags",
      "Do Not Infer",
    ]),
    extractField(content, "Etiketler", [
      "Hasta Özeti",
      "Temel Bilgi",
      "Triage",
      "Uyarı Bulguları",
      "Çıkarım Yapma",
    ]),
  );
  const genericSummary = content.replace(/\s+/g, " ").trim().slice(0, 700);
  const genericTitle = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "";

  return {
    topic: topic || genericTitle,
    tags: tagsRaw
      .split(/[,\n]/)
      .map((part) => normalizeKnowledgeText(part).trim())
      .filter(Boolean),
    patientSummary: firstNonEmpty(
      extractField(content, "Source Summary", [
        "Key Takeaway",
        "Clinical Takeaway",
        "Safe Guidance",
        "Red Flags",
        "Do Not Infer",
      ]),
      extractField(content, "Patient Summary", [
        "Key Takeaway",
        "Clinical Takeaway",
        "Safe Guidance",
        "Red Flags",
        "Do Not Infer",
      ]),
      extractField(content, "Hasta Özeti", [
        "Temel Bilgi",
        "Triage",
        "Uyarı Bulguları",
        "Çıkarım Yapma",
      ]),
      extractField(content, "Yakınma", [
        "Temel Bilgi",
        "Triage",
        "Uyarı Bulguları",
        "Çıkarım Yapma",
      ]),
      genericSummary,
    ),
    clinicalTakeaway: firstNonEmpty(
      extractField(content, "Key Takeaway", [
        "Clinical Takeaway",
        "Safe Guidance",
        "Red Flags",
        "Do Not Infer",
      ]),
      extractField(content, "Clinical Takeaway", [
        "Safe Guidance",
        "Red Flags",
        "Do Not Infer",
      ]),
      extractField(content, "Temel Bilgi", ["Triage", "Uyarı Bulguları", "Çıkarım Yapma"]),
      genericSummary,
    ),
    safeGuidance: firstNonEmpty(
      extractField(content, "Safe Guidance", ["Red Flags", "Do Not Infer"]),
      extractField(content, "Triage", ["Uyarı Bulguları", "Çıkarım Yapma"]),
    ),
    redFlags: firstNonEmpty(
      extractField(content, "Red Flags", ["Do Not Infer"]),
      extractField(content, "Uyarı Bulguları", ["Çıkarım Yapma"]),
    ),
    doNotInfer: firstNonEmpty(
      extractField(content, "Do Not Infer", []),
      extractField(content, "Çıkarım Yapma", []),
    ),
  };
}
