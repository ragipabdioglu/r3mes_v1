import { describe, expect, it } from "vitest";

import {
  buildDeterministicEvidenceExtraction,
  buildDeterministicQueryPlan,
  resolveAnswerIntent,
  runEvidenceExtractorSkill,
  runQueryPlannerSkill,
} from "./skillPipeline.js";

describe("skill pipeline query planner", () => {
  it("expands short abdominal pain queries into retrieval-ready symptom searches", () => {
    const plan = buildDeterministicQueryPlan({ userQuery: "karnım ağrıyor", language: "tr" });

    expect(plan.expectedEvidenceType).toBe("symptom_card");
    expect(plan.routePlan.domain).toBe("medical");
    expect(plan.routePlan.subtopics).toEqual(expect.arrayContaining(["karin_agrisi"]));
    expect(plan.searchQueries).toContain("karın ağrısı genel triyaj");
    expect(plan.searchQueries).toContain("karın ağrısı ateş kusma kanama acil belirtiler");
    expect(plan.mustIncludeTerms).toEqual(
      expect.arrayContaining(["karın", "ağrı", "ateş", "kusma", "kanama"]),
    );
    expect(plan.retrievalQuery).toContain("karnım ağrıyor");
    expect(plan.retrievalQuery).toContain("karın ağrısı genel triyaj");
  });

  it("keeps LoRA skill execution behind a stable envelope", async () => {
    const run = await runQueryPlannerSkill({ userQuery: "akıntım var", language: "tr" });

    expect(run.skill).toBe("query-planner");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.routePlan.domain).toBe("medical");
    expect(run.output.routePlan.subtopics).toContain("akinti");
    expect(run.output.expectedEvidenceType).toBe("symptom_card");
    expect(run.output.searchQueries).toContain("vajinal akıntı triyaj");
  });
});

describe("skill pipeline evidence extractor", () => {
  it("resolves answer intent from query and evidence signals", () => {
    const checklist = resolveAnswerIntent({
      userQuery: "Production migration öncesi kısa bir kontrol listesi verir misin?",
      weakIntent: "steps",
      directFactCount: 2,
      supportingFactCount: 1,
      sourceCount: 1,
    });

    expect(checklist.intent).toBe("steps");
    expect(checklist.primarySignal).toBe("checklist");
    expect(checklist.confidence).toBe("high");
    expect(checklist.reasons).toEqual(expect.arrayContaining(["query asks for checklist/list output"]));

    const noSource = resolveAnswerIntent({
      userQuery: "Bu belgeye göre kesin sonuç nedir?",
      weakIntent: "explain",
      directFactCount: 0,
      supportingFactCount: 0,
      missingInfoCount: 1,
      sourceCount: 0,
    });

    expect(noSource.primarySignal).toBe("no_source");
    expect(noSource.intent).toBe("unknown");
    expect(noSource.reasons).toEqual(expect.arrayContaining(["no directly usable evidence was found"]));
  });

  it("infers action intent from preparation questions before generic risk wording", () => {
    expect(
      resolveAnswerIntent({
        userQuery: "Production migration öncesi ne yapmalıyım? Riskleri abartmadan açıkla.",
      }).intent,
    ).toBe("steps");

    expect(
      resolveAnswerIntent({
        userQuery: "Boşanma davası için hangi belgeleri hazırlamalıyım?",
      }).intent,
    ).toBe("steps");

    expect(
      resolveAnswerIntent({
        userQuery: "Trafik cezasına itiraz etmek istiyorum. Süre ve belge açısından neye dikkat etmeliyim?",
      }).intent,
    ).toBe("steps");

    expect(
      resolveAnswerIntent({
        userQuery: "Boşanma sürecinde mal paylaşımı için hangi kayıtları toplamam gerekir?",
      }).intent,
    ).toBe("steps");

    expect(
      resolveAnswerIntent({
        userQuery: "Özel eğitim için RAM raporu ve BEP planı hakkında okulda ne sormalıyım?",
      }).intent,
    ).toBe("steps");
  });

  it("turns retrieved cards into compact usable evidence and limits unsafe inference", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Smear temiz ama kasık ağrım var",
      cards: [
        {
          sourceId: "doc-1",
          title: "smear-kasik-karti",
          clinicalTakeaway:
            "Temiz smear iyi bir bulgudur, ancak kasık ağrısını tek başına açıklamaz.",
          safeGuidance:
            "Ağrı sürüyor veya artıyorsa kadın hastalıkları değerlendirmesi uygundur.",
          redFlags: "Şiddetli ağrı, ateş veya anormal kanama varsa daha hızlı değerlendirme gerekir.",
          doNotInfer: "Soruda açık dayanak yoksa CA-125 veya ileri tetkik gerekliliği çıkarma.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Temiz smear iyi bir bulgudur"),
      ]),
    );
    expect(extraction.supportingContext).toEqual(
      expect.arrayContaining([expect.stringContaining("Ağrı sürüyor veya artıyorsa")]),
    );
    expect(extraction.redFlags).toEqual(expect.arrayContaining([expect.stringContaining("Şiddetli ağrı")]));
    expect(extraction.uncertainOrUnusable).toEqual(
      expect.arrayContaining([expect.stringContaining("CA-125")]),
    );
    expect(extraction.intentResolution.intent).toBe("triage");
    expect(extraction.intentResolution.reasons).toEqual(expect.arrayContaining(["retrieved evidence contains risk facts"]));
    expect(extraction.sourceIds).toContain("doc-1");
  });

  it("keeps evidence extraction behind the same stable skill envelope", async () => {
    const run = await runEvidenceExtractorSkill({
      userQuery: "karın ağrısı var",
      cards: [{ sourceId: "doc-2", title: "karin-karti", safeGuidance: "Karın ağrısının şiddeti izlenmelidir." }],
    });

    expect(run.skill).toBe("evidence-extractor");
    expect(run.runtime).toBe("deterministic");
    expect(run.output.usableFacts).toContain("karin-karti: Karın ağrısının şiddeti izlenmelidir.");
  });

  it("does not promote weak generic guidance without enough query overlap", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Bebeğim çok terliyor neden olabilir?",
      cards: [
        {
          sourceId: "doc-generic",
          title: "generic",
          clinicalTakeaway: "Genel değerlendirme gerekebilir.",
          safeGuidance: "Belirtiler devam ederse uygun uzmana başvurulmalıdır.",
          doNotInfer: "Kaynakta açık dayanak yoksa neden uydurma.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual([]);
    expect(extraction.missingInfo).toEqual(
      expect.arrayContaining(["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]),
    );
  });

  it("extracts actionable education guidance with inflected query terms", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Özel eğitim desteği için okulda ilk hangi adımları konuşmalıyım?",
      cards: [
        {
          sourceId: "education-special-ram-bep",
          title: "education-special-ram-bep",
          clinicalTakeaway:
            "BEP planı öğrencinin ihtiyacına göre hazırlanır; veli, okul ve rehberlik birimi düzenli değerlendirme ve güncelleme yapmalıdır.",
          safeGuidance:
            "Veli rapor, okul görüşmesi, gözlem notu ve BEP hedeflerini saklamalı; belirsizlikte rehberlik servisi veya RAM ile görüşmelidir.",
          redFlags:
            "Çocuğun güvenliği, eğitimden kopma, raporun yanlış uygulanması veya ciddi uyum sorunu varsa hızlı okul/RAM değerlendirmesi gerekir.",
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("rehberlik")]));
    expect(extraction.missingInfo).toEqual([]);
  });

  it("uses source summaries and canonical Turkish tokens for legal knowledge cards", () => {
    const deposit = buildDeterministicEvidenceExtraction({
      userQuery: "Ev sahibi depozitomu iade etmiyor. Elimde sözleşme ve dekont var, ilk ne yapmalıyım?",
      cards: [
        {
          sourceId: "multi-legal-rent-deposit",
          title: "multi-legal-rent-deposit",
          patientSummary:
            "Kiracı depozitonun iadesi için sözleşme, ödeme dekontu, teslim tutanağı ve yazışmaları saklamalıdır.",
          clinicalTakeaway:
            "Depozito uyuşmazlığında sözleşme hükümleri, hasar tespiti, ödeme kaydı ve teslim tarihi birlikte değerlendirilir.",
          safeGuidance:
            "Kişi belgeleri düzenlemeli, yazılı başvuru yapmalı ve hak kaybı riski varsa avukat veya yetkili kurumdan destek almalıdır.",
        },
      ],
    });

    expect(deposit.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("depozitonun iadesi")]));
    expect(deposit.missingInfo).toEqual([]);

    const protocol = buildDeterministicEvidenceExtraction({
      userQuery: "Anlaşmalı boşanma protokolünde hangi başlıkları netleştirmeliyim? Kısa açıkla.",
      cards: [
        {
          sourceId: "legal-divorce-agreed-protocol",
          title: "legal-divorce-agreed-protocol",
          patientSummary:
            "Anlaşmalı boşanma protokolünde velayet, nafaka, mal paylaşımı, kişisel ilişki, masraf ve taraf iradeleri açık yazılmalıdır.",
          clinicalTakeaway:
            "Protokolün eksik veya belirsiz olması süreçte uyuşmazlık doğurabilir; imza öncesi belgeler ve anlaşma maddeleri birlikte kontrol edilmelidir.",
        },
      ],
    });

    expect(protocol.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("velayet, nafaka")]));
    expect(protocol.missingInfo).toEqual([]);
  });

  it("extracts evidence from technical runbook style raw sections", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Production migration öncesi hangi kontrolleri yapmalıyım?",
      cards: [
        {
          sourceId: "runbook-1",
          title: "db-migration-runbook",
          rawContent: `# DB Migration Runbook

Checklist:
- Production migration öncesi yedek alınmalı, staging çıktısı doğrulanmalı ve rollback planı hazır olmalıdır.

Risks:
- Yedeksiz işlem veya veri silen komutlar yüksek risklidir.

Limitations:
- Ortama özel bağlantı ayarı kaynakta yoksa uydurulmamalıdır.`,
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("yedek alınmalı")]));
    expect(extraction.redFlags).toEqual(expect.arrayContaining([expect.stringContaining("Yedeksiz işlem")]));
    expect(extraction.uncertainOrUnusable).toEqual(expect.arrayContaining([expect.stringContaining("bağlantı ayarı")]));
    expect(extraction.missingInfo).toEqual([]);
  });

  it("does not promote contradictory evidence as usable facts", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Production migration öncesi rollback planı gerekli mi?",
      cards: [
        {
          sourceId: "runbook-a",
          title: "runbook-a",
          rawContent: `Checklist:
Rollback planı production migration öncesi gerekli ve hazır olmalıdır.`,
        },
        {
          sourceId: "runbook-b",
          title: "runbook-b",
          rawContent: `Checklist:
Rollback planı production migration öncesi gerekli değil, doğrudan migration yapılabilir.`,
        },
      ],
    });

    expect(extraction.usableFacts).toEqual([]);
    expect(extraction.notSupported).toEqual(expect.arrayContaining([expect.stringContaining("Çelişen kaynak bilgisi")]));
    expect(extraction.missingInfo).toEqual(
      expect.arrayContaining(["Kaynaklar arasında çelişki olduğu için doğrudan öneri çıkarılmadı."]),
    );
  });

  it("flags contradiction wording from retrieved cards instead of smoothing it over", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Production migration için rollback planı gerekli mi?",
      cards: [
        {
          sourceId: "safe",
          title: "safe-runbook",
          rawContent: `Key Takeaway: Rollback planı olmadan production migration çalıştırılmamalıdır.`,
        },
        {
          sourceId: "unsafe",
          title: "unsafe-runbook",
          rawContent: `Key Takeaway: Rollback planı production migration için gerekli değildir iddiası diğer kaynakla çelişir.`,
        },
      ],
    });

    expect(extraction.notSupported.join(" ")).toContain("çeliş");
    expect(extraction.usableFacts.join(" ")).not.toContain("gerekli değildir");
  });

  it("extracts markdown table rows as readable evidence fragments", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Migration öncesi yedek ve rollback için ne kontrol edilmeli?",
      cards: [
        {
          sourceId: "table-runbook",
          title: "table-runbook",
          rawContent: `Checklist:
| Kontrol | Yapılacak |
| --- | --- |
| Yedek | Migration öncesi yedek alınmalı |
| Rollback | Rollback planı hazır olmalı |`,
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("Yedek - Migration öncesi yedek")]));
    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("Rollback - Rollback planı")]));
    expect(extraction.missingInfo).toEqual([]);
  });

  it("extracts evidence from education markdown headings without card-specific labels", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "RAM raporu sonrası BEP planını okulda nasıl konuşmalıyım?",
      cards: [
        {
          sourceId: "education-raw-1",
          title: "raw-bep-note",
          rawContent: `## Kullanılabilir Bilgiler
RAM raporu sonrası BEP planı okul rehberlik birimi, veli ve öğretmenle birlikte değerlendirilmelidir.

## Ne Yapmalı
Veli BEP hedeflerini, okul gözlem notlarını ve güncelleme tarihlerini yazılı takip etmelidir.

## Uyarılar
Raporun yanlış uygulanması veya çocuğun eğitimden kopması hızlı okul/RAM değerlendirmesi gerektirir.

## Kullanılamayan
Kaynak kesin tanı veya tedavi önerisi vermiyor.`,
        },
      ],
    });

    expect(extraction.usableFacts).toEqual(expect.arrayContaining([expect.stringContaining("BEP planı")]));
    expect(extraction.supportingContext).toEqual(expect.arrayContaining([expect.stringContaining("BEP hedeflerini")]));
    expect(extraction.redFlags).toEqual(expect.arrayContaining([expect.stringContaining("Raporun yanlış uygulanması")]));
    expect(extraction.notSupported).toEqual(expect.arrayContaining([expect.stringContaining("kesin tanı")]));
    expect(extraction.missingInfo).toEqual([]);
  });

  it("does not promote unrelated raw sections just because they are present", () => {
    const extraction = buildDeterministicEvidenceExtraction({
      userQuery: "Bebeğim çok terliyor neden olabilir?",
      cards: [
        {
          sourceId: "legal-raw-1",
          title: "traffic-fine-note",
          rawContent: `Gerçekler: Trafik cezasına itirazda tebliğ tarihi ve başvuru süresi kontrol edilmelidir.

Öneri: Ceza tutanağı ve ödeme belgesi saklanmalıdır.

Dikkat: Süre kaçarsa hak kaybı olabilir.`,
        },
      ],
    });

    expect(extraction.usableFacts).toEqual([]);
    expect(extraction.answerIntent).toBe("unknown");
    expect(extraction.intentResolution.primarySignal).toBe("no_source");
    expect(extraction.missingInfo).toEqual(
      expect.arrayContaining(["Soruya doğrudan dayanak sağlayan yeterli kaynak cümlesi bulunamadı."]),
    );
  });
});
