import { describe, expect, it } from "vitest";
import { parseGroundedMedicalAnswer } from "./answerParse.js";
import { renderGroundedMedicalAnswer } from "./renderMedicalAnswer.js";

describe("grounded answer parse/render", () => {
  it("uses natural answer field as the primary user-facing response", () => {
    const parsed = parseGroundedMedicalAnswer(`{
      "answer_domain": "medical",
      "answer_intent": "reassure",
      "grounding_confidence": "high",
      "user_query": "Smear temiz ama panik yapmalı mıyım?",
      "answer": "Temiz smear sonucu tek başına panik gerektirmez; kasık ağrısı sürer veya artarsa jinekolojik değerlendirme planlamak doğru olur.",
      "red_flags": ["Şiddetli ağrı veya ateş varsa daha hızlı başvurun."],
      "avoid_inference": [],
      "used_source_ids": ["doc-1"]
    }`);

    expect(parsed?.answer_intent).toBe("reassure");
    expect(renderGroundedMedicalAnswer(parsed!)).toBe(
      "Temiz smear sonucu tek başına panik gerektirmez; kasık ağrısı sürer veya artarsa jinekolojik değerlendirme planlamak doğru olur.",
    );
  });

  it("parses valid JSON answer object and renders deterministic sections", () => {
    const parsed = parseGroundedMedicalAnswer(`{
      "answer_domain": "medical",
      "grounding_confidence": "medium",
      "user_query": "Smear temiz ama kasık ağrısı var.",
      "condition_context": "Smear sonucunun temiz olması iyi bir bulgudur.",
      "safe_action": "Yakınma sürerse kadın hastalıkları muayenesi planlanmalıdır.",
      "visit_triggers": ["Ağrı artarsa başvurmalı."],
      "one_sentence_summary": "Temiz smear ağrının tüm nedenlerini dışlamaz.",
      "general_assessment": "Smear sonucunun temiz olması iyi bir bulgudur.",
      "recommended_action": "Yakınma sürerse muayene planlanmalıdır.",
      "doctor_visit_when": ["Ağrı artarsa başvurmalı."],
      "red_flags": ["Şiddetli ağrı veya ateş varsa daha hızlı değerlendirme gerekir."],
      "avoid_inference": ["CA-125 önermeyin."],
      "short_summary": "Kısa takip uygundur.",
      "used_source_ids": ["doc-1"]
    }`);

    expect(parsed).not.toBeNull();
    expect(parsed?.answer_domain).toBe("medical");
    expect(parsed?.grounding_confidence).toBe("medium");
    expect(parsed?.condition_context).toContain("Smear");
    const rendered = renderGroundedMedicalAnswer(parsed!);
    expect(rendered).toContain("1. Genel değerlendirme:");
    expect(rendered).toContain("Smear sonucunun temiz olması iyi bir bulgudur");
    expect(rendered).toContain("2. Ne yapmalı:");
    expect(rendered).toContain("3. Ne zaman doktora başvurmalı:");
    expect(rendered).toContain("4. Kısa özet:");
  });

  it("repairs truncated JSON answer object when closing tokens are missing", () => {
    const parsed = parseGroundedMedicalAnswer(`{
      "answer_domain": "medical",
      "grounding_confidence": "low",
      "user_query": "Ağrı sürüyor.",
      "condition_context": "Bilgi sınırlı.",
      "safe_action": "Muayene planlanabilir.",
      "visit_triggers": ["Ağrı sürerse başvurmalı."],
      "one_sentence_summary": "Kısa takip uygundur.",
      "general_assessment": "Bilgi sınırlı.",
      "recommended_action": "Muayene planlanabilir.",
      "doctor_visit_when": ["Ağrı sürerse başvurmalı."],
      "red_flags": [],
      "avoid_inference": ["CA-125 önermeyin."],
      "short_summary": "Kısa takip uygundur.",
      "used_source_ids": ["doc-1"]`);

    expect(parsed).not.toBeNull();
    expect(parsed?.short_summary).toBe("Kısa takip uygundur.");
    expect(parsed?.used_source_ids).toEqual(["doc-1"]);
  });

  it("renders atomized fields and strips blocked inference leakage", () => {
    const rendered = renderGroundedMedicalAnswer({
      answer_domain: "medical",
      grounding_confidence: "high",
      user_query: "Smear temiz ama kasık ağrısı var.",
      condition_context: "Smear sonucunun temiz olması iyi bir bulgudur. CA-125 takibi gerekir.",
      safe_action: "Yakınma sürerse kadın hastalıkları muayenesi planlanmalıdır.",
      visit_triggers: ["Şiddetli ağrı, ateş veya anormal kanama olursa daha hızlı başvurun."],
      one_sentence_summary: "Temiz smear kasık ağrısının tüm nedenlerini dışlamaz.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: [],
      avoid_inference: ["CA-125 takibi gerekir."],
      short_summary: "",
      used_source_ids: ["doc-1"],
    });

    expect(rendered).toContain("Smear sonucunun temiz olması iyi bir bulgudur");
    expect(rendered).not.toContain("CA-125");
    expect(rendered).toContain("Temiz smear kasık ağrısının tüm nedenlerini dışlamaz");
  });

  it("does not use clinical templates on the main answer path", () => {
    const rendered = renderGroundedMedicalAnswer({
      answer_domain: "medical",
      grounding_confidence: "high",
      user_query: "Smear temiz ama kasık ağrısı var.",
      condition_context: "Kullanıcı, temiz smear sonucuyla birlikte ara ara kasık ağrısı olduğunu soruyor.",
      safe_action: "Doktor kontrolünde daha fazla incelemeyi öneririm.",
      visit_triggers: [],
      one_sentence_summary: "Temiz smear kasık ağrısı olabilir.",
      general_assessment: "",
      recommended_action: "",
      doctor_visit_when: [],
      red_flags: [],
      avoid_inference: [],
      short_summary: "",
      used_source_ids: ["doc-1"],
    });

    expect(rendered).toContain("Kullanıcı, temiz smear sonucuyla birlikte ara ara kasık ağrısı olduğunu soruyor.");
    expect(rendered).toContain("Doktor kontrolünde daha fazla incelemeyi öneririm.");
    expect(rendered).not.toContain("Smear sonucunun temiz olması iyi bir bulgudur");
  });

  it("keeps clinical templates available for explicit fallback rendering", () => {
    const rendered = renderGroundedMedicalAnswer(
      {
        answer_domain: "medical",
        grounding_confidence: "high",
        user_query: "Smear temiz ama kasık ağrısı var.",
        condition_context: "Kullanıcı, temiz smear sonucuyla birlikte ara ara kasık ağrısı olduğunu soruyor.",
        safe_action: "Doktor kontrolünde daha fazla incelemeyi öneririm.",
        visit_triggers: [],
        one_sentence_summary: "Temiz smear kasık ağrısı olabilir.",
        general_assessment: "",
        recommended_action: "",
        doctor_visit_when: [],
        red_flags: [],
        avoid_inference: [],
        short_summary: "",
        used_source_ids: ["doc-1"],
      },
      { useFallbackTemplate: true },
    );

    expect(rendered).toContain("Smear sonucunun temiz olması iyi bir bulgudur");
    expect(rendered).toContain("kadın hastalıkları muayenesi");
  });
});
