import { describe, expect, it } from "vitest";

import { detectAnswerTask } from "./answerTaskDetector.js";

describe("detectAnswerTask", () => {
  it("detects list-style educational questions without domain-specific field rules", () => {
    const task = detectAnswerTask("Büyük verinin 5V özelliğini sadece madde madde yaz. Her madde en fazla 1 cümle olsun.");

    expect(task.taskType).toBe("list_items");
    expect(task.answerIntent).toBe("explain");
    expect(task.outputConstraints.format).toBe("bullets");
    expect(task.outputConstraints.maxSentencesPerBullet).toBe(1);
    expect(task.outputConstraints.forbidCaution).toBe(true);
  });

  it("detects generic type/category list wording without data-specific literals", () => {
    const variants = [
      "Varsayılan proje çeşitlerini madde madde yaz.",
      "Kaynakta geçen dosya türleri nelerdir?",
    ].map((query) => detectAnswerTask(query));

    for (const task of variants) {
      expect(task.taskType).toBe("list_items");
      expect(task.answerIntent).toBe("explain");
    }
    expect(variants[0]?.outputConstraints.format).toBe("bullets");
  });

  it("detects generic timing questions as concise source-grounded explanations", () => {
    const task = detectAnswerTask("Bir olay ne zaman çalışır?");

    expect(task.taskType).toBe("source_grounded_explain");
    expect(task.answerIntent).toBe("explain");
    expect(task.outputConstraints.maxWords).toBe(45);
    expect(task.diagnostics.taskReasons).toContain("timing_language");
  });

  it("keeps safety-triage timing questions out of generic timing detection", () => {
    const task = detectAnswerTask("Ne zaman doktora başvurmalı?");

    expect(task.taskType).not.toBe("source_grounded_explain");
    expect(task.diagnostics.taskReasons).not.toContain("timing_language");
  });

  it("detects comparison tasks and source-grounded constraints", () => {
    const task = detectAnswerTask("IoT cihazı ile akıllı cihaz aynı şey mi? Kaynağa göre farkını açıkla.");

    expect(task.taskType).toBe("compare_concepts");
    expect(task.answerIntent).toBe("compare");
    expect(task.outputConstraints.sourceGroundedOnly).toBe(true);
    expect(task.forbiddenAdditions).toContain("source_external_inference");
  });

  it("detects inflected Turkish comparison wording without data-specific terms", () => {
    const task = detectAnswerTask("İki yaklaşımın farklarını tablo olarak ver.");

    expect(task.taskType).toBe("compare_concepts");
    expect(task.answerIntent).toBe("compare");
    expect(task.outputConstraints.format).toBe("table");
  });

  it("detects document hints independently from hardcoded collection names", () => {
    const task = detectAnswerTask("4. hafta dosyasındaki öğrencilerin telif hakkı sorusuna verdiği genel görüşler ne yönde?");

    expect(task.taskType).toBe("summarize_opinions");
    expect(task.targetDocumentHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "week", value: "4. hafta" }),
      ]),
    );
  });

  it("detects generic code explanation questions without data-specific literals", () => {
    const task = detectAnswerTask("submitHandler içinde ne yapılıyor? Kaynağa göre açıkla.");

    expect(task.taskType).toBe("code_explanation");
    expect(task.answerIntent).toBe("explain");
    expect(task.outputConstraints.sourceGroundedOnly).toBe(true);
  });

  it("keeps finance field extraction as one provider under the generic task detector", () => {
    const task = detectAnswerTask(
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar nedir? Sadece rakamı yaz, risk yorumu ekleme.",
    );

    expect(task.taskType).toBe("field_extraction");
    expect(task.requestedFields.map((field) => field.id)).toContain("dagitilmasi_ongorulen_diger_kaynaklar");
    expect(task.outputConstraints.noRawTableDump).toBe(true);
    expect(task.outputConstraints.forbidCaution).toBe(true);
  });
});
