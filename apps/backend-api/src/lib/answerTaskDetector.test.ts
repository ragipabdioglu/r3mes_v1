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

  it("detects comparison tasks and source-grounded constraints", () => {
    const task = detectAnswerTask("IoT cihazı ile akıllı cihaz aynı şey mi? Kaynağa göre farkını açıkla.");

    expect(task.taskType).toBe("compare_concepts");
    expect(task.answerIntent).toBe("compare");
    expect(task.outputConstraints.sourceGroundedOnly).toBe(true);
    expect(task.forbiddenAdditions).toContain("source_external_inference");
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

  it("keeps finance field extraction as one provider under the generic task detector", () => {
    const task = detectAnswerTask(
      "EREGL kar payında dağıtılması öngörülen diğer kaynaklar nedir? Sadece rakamı yaz, risk yorumu ekleme.",
    );

    expect(task.taskType).toBe("field_extraction");
    expect(task.requestedFields.map((field) => field.id)).toContain("diger_kaynaklar");
    expect(task.outputConstraints.noRawTableDump).toBe(true);
    expect(task.outputConstraints.forbidCaution).toBe(true);
  });
});
