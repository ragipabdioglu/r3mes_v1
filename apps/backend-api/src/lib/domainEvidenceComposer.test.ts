import { describe, expect, it } from "vitest";

import { composeDomainEvidenceAnswer } from "./domainEvidenceComposer.js";

describe("composeDomainEvidenceAnswer", () => {
  it("renders technical evidence without inventing destructive steps", () => {
    const rendered = composeDomainEvidenceAnswer({
      answer_domain: "technical",
      answer_intent: "steps",
      grounding_confidence: "high",
      user_query: "Production veritabanında migration öncesi ne yapmalıyım?",
      answer: "",
      condition_context: "Migration çalıştırmadan önce yedek alınmalı, staging ortamında denenmeli ve rollback planı hazırlanmalıdır.",
      safe_action: "Üretim veritabanında migration doğrudan denenmemeli; önce yedek, test ve geri dönüş adımı net olmalıdır.",
      visit_triggers: [],
      one_sentence_summary: "Migration öncesi yedek, staging testi ve rollback planı net olmalıdır.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: ["Yedeksiz işlem, uzun kilit süresi ve belirsiz rollback yüksek risklidir."],
      avoid_inference: [],
      short_summary: "Migration öncesi yedek, staging testi ve rollback planı net olmalıdır.",
      used_source_ids: ["technical-1"],
    });

    expect(rendered).toContain("Kısa plan:");
    expect(rendered).toContain("yedek");
    expect(rendered).toContain("rollback");
    expect(rendered).not.toMatch(/\b(drop|truncate|delete)\b/iu);
    expect(rendered).not.toContain("geri yükleyin");
  });

  it("renders legal evidence with legal labels and cautious wording", () => {
    const rendered = composeDomainEvidenceAnswer({
      answer_domain: "legal",
      answer_intent: "steps",
      grounding_confidence: "medium",
      user_query: "Boşanma davası açmadan önce ne hazırlamalıyım?",
      answer: "",
      condition_context: "Boşanma sürecinde dilekçe, delil, varsa velayet ve mal paylaşımı bilgileri önemlidir.",
      safe_action: "Somut belge ve süreler için avukat veya yetkili kurumdan destek alınmalıdır.",
      visit_triggers: [],
      one_sentence_summary: "Belge ve süreler netleştirilmeden kesin hukuki sonuç söylenmemelidir.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: ["Süre kaçırma veya eksik belge hak kaybı doğurabilir."],
      avoid_inference: [],
      short_summary: "Belge, delil ve süreler netleşmeden kesin sonuç verilmemelidir.",
      used_source_ids: ["legal-1"],
    });

    expect(rendered).toContain("Kısa plan:");
    expect(rendered).toContain("avukat");
    expect(rendered).not.toContain("kesin kazan");
  });

  it("puts risk first for triage intent", () => {
    const rendered = composeDomainEvidenceAnswer({
      answer_domain: "medical",
      answer_intent: "triage",
      grounding_confidence: "high",
      user_query: "Şiddetli ağrıda ne zaman doktora gitmeliyim?",
      answer: "",
      condition_context: "Ağrının şiddeti, süresi ve eşlik eden belirtiler önemlidir.",
      safe_action: "Yakınma sürerse uygun bir muayene planlanmalıdır.",
      visit_triggers: ["Şiddetli ağrı, ateş veya anormal kanama varsa hızlı değerlendirme gerekir."],
      one_sentence_summary: "Alarm bulguları varsa bekletmeden değerlendirme gerekir.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: [],
      avoid_inference: [],
      short_summary: "Alarm bulguları varsa bekletmeden değerlendirme gerekir.",
      used_source_ids: ["medical-1"],
    });

    expect(rendered.split("\n")[0]).toContain("Ne zaman doktora başvurmalı:");
    expect(rendered).toContain("Şiddetli ağrı");
  });

  it("uses generic evidence fields for medical fallback instead of topic-specific templates", () => {
    const rendered = composeDomainEvidenceAnswer({
      answer_domain: "medical",
      answer_intent: "steps",
      grounding_confidence: "medium",
      user_query: "Yeni yüklediğim sağlık verisine göre ne yapmalıyım?",
      answer: "",
      condition_context: "Kaynak, takip kararının belirti süresi ve eşlik eden bulgulara göre verilmesi gerektiğini söylüyor.",
      safe_action: "Belirti sürerse ilgili uzman değerlendirmesi planlanmalıdır.",
      visit_triggers: ["Şikayet hızla artarsa veya yeni alarm bulgusu eklenirse daha hızlı başvurulmalıdır."],
      one_sentence_summary: "Kaynak, belirtiye göre kontrollü takip öneriyor.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: [],
      avoid_inference: [],
      short_summary: "",
      used_source_ids: ["new-medical-doc"],
    });

    expect(rendered).toContain("belirti süresi");
    expect(rendered).toContain("ilgili uzman");
    expect(rendered).not.toContain("Smear sonucunun temiz olması");
    expect(rendered).not.toContain("kasık ağrısı");
  });

  it("marks low-grounding answers as limited", () => {
    const rendered = composeDomainEvidenceAnswer({
      answer_domain: "education",
      answer_intent: "explain",
      grounding_confidence: "low",
      user_query: "Bu yönetmelik ne anlama gelir?",
      answer: "",
      condition_context: "Eldeki parça yönetmeliğin yalnızca genel çerçevesini anlatıyor.",
      safe_action: "Kesin uygulama için kurumun güncel duyurusu kontrol edilmelidir.",
      visit_triggers: [],
      one_sentence_summary: "Kaynak sınırlı olduğu için kesin uygulama söylenmemelidir.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: ["Kaynakta tarih ve kurum detayı yoksa kesin uygulama uydurulmamalıdır."],
      avoid_inference: [],
      short_summary: "",
      used_source_ids: ["education-1"],
    });

    expect(rendered.split("\n")[0]).toContain("net ve kesin bir cevap vermek doğru olmaz");
    expect(rendered).toContain("Pratik anlamı:");
  });
});
