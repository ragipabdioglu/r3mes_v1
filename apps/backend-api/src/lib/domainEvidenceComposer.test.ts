import { describe, expect, it } from "vitest";

import { buildAnswerPlan, type AnswerPlan } from "./answerPlan.js";
import type { AnswerSpec } from "./answerSpec.js";
import type { CompiledEvidence } from "./compiledEvidence.js";
import { composeAnswerSpec, composeDomainEvidenceAnswer, composePlannedAnswer } from "./domainEvidenceComposer.js";

function compiledEvidence(overrides: Partial<CompiledEvidence> = {}): CompiledEvidence {
  return {
    facts: [],
    structuredFacts: [],
    risks: [],
    unknowns: [],
    contradictions: [],
    sourceIds: ["kap-doc"],
    confidence: "high",
    usableFactCount: 0,
    structuredFactCount: 0,
    riskFactCount: 0,
    unknownCount: 0,
    contradictionCount: 0,
    ...overrides,
  };
}

function fieldExtractionPlan(overrides: Partial<AnswerPlan> = {}): AnswerPlan {
  const requestedFields = [
    {
      id: "required_metric",
      label: "Required Metric",
      aliases: ["required metric"],
      required: true,
      outputHint: "text" as const,
      confidence: "high" as const,
      matchedAliases: ["required metric"],
    },
    {
      id: "second_metric",
      label: "Second Metric",
      aliases: ["second metric"],
      required: true,
      outputHint: "text" as const,
      confidence: "high" as const,
      matchedAliases: ["second metric"],
    },
  ];
  return {
    domain: "general",
    intent: "explain",
    taskType: "field_extraction",
    outputFormat: "short",
    requestedFields,
    selectedFacts: [],
    constraints: {
      forbidCaution: true,
      noRawTableDump: true,
      sourceGroundedOnly: true,
      format: "short",
    },
    coverage: "partial",
    forbiddenAdditions: ["optional_caution"],
    requiresModelSynthesis: true,
    diagnostics: {
      requestedFieldCount: requestedFields.length,
      selectedFactCount: 0,
      missingFieldIds: ["second_metric"],
    },
    ...overrides,
  };
}

function genericFieldAnswerSpec(overrides: Partial<AnswerSpec> = {}): AnswerSpec {
  return {
    answerDomain: "general",
    answerIntent: "explain",
    groundingConfidence: "high",
    userQuery: "Required Metric ve Second Metric alanlarını kısa yaz, uyarı ekleme.",
    tone: "direct",
    sections: ["assessment", "action", "summary"],
    assessment: "Kaynakta istenen alanların bir kısmı bulunuyor.",
    action: "Sadece kaynakta doğrulanan alanlar yazılmalıdır.",
    caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
    summary: "Sorulan alanlar kaynakla sınırlıdır.",
    unknowns: [],
    sourceIds: ["generic-source"],
    facts: ["Required Metric kaynakta doğrulanmış bir metin değeri olarak geçiyor."],
    structuredFacts: [],
    ...overrides,
  };
}

describe("composeDomainEvidenceAnswer", () => {
  it("renders directly from AnswerSpec without requiring legacy grounded answer fields", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "education",
      answerIntent: "explain",
      groundingConfidence: "medium",
      userQuery: "Öğrenci devamsızlığı nasıl değerlendirilir?",
      tone: "direct",
      sections: ["assessment", "action", "caution", "summary"],
      assessment: "Kaynak, devamsızlık değerlendirmesinde okulun güncel kayıtlarının esas alınacağını söylüyor.",
      action: "Öğrenci ve veli, okul yönetimi veya rehberlik birimiyle kayıtları netleştirmelidir.",
      caution: ["Kaynakta açık tarih veya kurum kararı yoksa kesin uygulama söylenmemelidir."],
      summary: "Devamsızlık için güncel okul kaydı ve resmi uygulama kontrol edilmelidir.",
      unknowns: [],
      sourceIds: ["education-attendance"],
      facts: ["Okulun güncel kayıtları esas alınır."],
    });

    expect(rendered).toContain("okulun güncel kayıtları");
    expect(rendered).toContain("Pratik anlamı:");
    expect(rendered).not.toContain("Smear");
    expect(rendered).not.toContain("kasık");
  });

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

  it("surfaces query-relevant evidence details that are not selected as the main action", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "legal",
      answerIntent: "steps",
      groundingConfidence: "high",
      userQuery: "Bozuk ürün için fatura ve fotoğraf gibi belgelerle nasıl ilerlemeliyim?",
      tone: "direct",
      sections: ["action", "assessment", "caution", "summary"],
      assessment: "Tüketici ayıplı ürün aldığını ve satıcının iade kabul etmediğini söylüyor.",
      action: "Tüketici belgeleri saklayarak satıcıya yazılı başvuru yapmalıdır.",
      caution: ["Sürelerin kaçması veya delil niteliğinin kaybolması risk oluşturabilir."],
      summary: "Ayıplı ürün uyuşmazlığında belgeli ilerlemek gerekir.",
      unknowns: [],
      sourceIds: ["defective-product"],
      facts: [
        "Ayıplı ürün uyuşmazlığında fatura, garanti belgesi, yazışmalar, fotoğraf ve başvuru tarihleri önemlidir.",
        "Tüketici belgeleri saklayarak satıcıya yazılı başvuru yapmalıdır.",
      ],
    });

    expect(rendered).toContain("Ek kontrol:");
    expect(rendered).toContain("fatura");
    expect(rendered).toContain("fotoğraf");
  });

  it("uses shared Turkish concept expansion when surfacing relevant medical follow-up facts", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "medical",
      answerIntent: "reassure",
      groundingConfidence: "high",
      userQuery: "Yumurtalık kistimin boyutu söylendi ama korktum. Boyut tek başına ameliyat kararı mıdır?",
      tone: "calm",
      sections: ["assessment", "action", "caution", "summary"],
      assessment:
        "Kist veya kitle ifadesi tek başına ameliyat gerektirir anlamına gelmez; boyut, görünüm ve yakınmalar birlikte değerlendirilir.",
      action:
        "Soruda belirtilen kist, boyut bilgisi kaynak yanıtını yorumlarken korunmalı; bu başlıklar kesin tanı yerine uygun muayene/kontrol bağlamında değerlendirilmelidir.",
      caution: ["Kaynakta açık dayanak yoksa tanı, ilaç, test veya kesin neden çıkarılmamalıdır."],
      summary:
        "Kist veya kitle ifadesi tek başına ameliyat gerektirir anlamına gelmez; boyut, görünüm ve yakınmalar birlikte değerlendirilir.",
      unknowns: [],
      sourceIds: ["clinical-card-152"],
      facts: [
        "Kullanıcı, yumurtalık kisti/kitle ifadesinin takip veya müdahale gerektirip gerektirmediğini soruyor.",
        "Kist veya kitle ifadesi tek başına ameliyat gerektirir anlamına gelmez; boyut, görünüm ve yakınmalar birlikte değerlendirilir.",
      ],
    });

    expect(rendered).toContain("Ek kontrol:");
    expect(rendered).toContain("takip");
  });

  it("deduplicates step answers when the best action and assessment are the same fact", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "education",
      answerIntent: "steps",
      groundingConfidence: "high",
      userQuery: "Veli çocuğunda ateş veya öksürük belirtisi görürse ne yapmalı?",
      tone: "direct",
      sections: ["action", "assessment", "caution", "summary"],
      assessment: "Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.",
      action: "Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa idareyi bilgilendirerek okuluna göndermeyiniz.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Yüksek ateş, öksürük ya da başka bir hastalık belirtisi varsa okul idaresi bilgilendirilmelidir.",
      unknowns: [],
      sourceIds: ["education-1"],
      facts: [],
    });

    expect(rendered).toContain("1. Yüksek ateş");
    expect(rendered).not.toContain("2. Yüksek ateş");
  });

  it("uses structured facts for requested table fields without adding caution", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "finance",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery:
        "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
      tone: "direct",
      sections: ["assessment", "action", "summary"],
      assessment: "Kaynakta ilgili KAP tablo satırları var.",
      action: "Sadece sorulan tablo değerleri yazılmalıdır.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Sorulan alanlar KAP tablosundan alınmalıdır.",
      unknowns: [],
      sourceIds: ["kap-doc"],
      facts: [],
      structuredFacts: [
        {
          id: "sf-1",
          kind: "table_row",
          sourceId: "kap-doc",
          field: "Dağıtılması Öngörülen Diğer Kaynaklar",
          value: "3.352.908.083 / 3.850.000.000",
          confidence: "high",
          provenance: {
            quote: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 3.850.000.000",
            extractor: "table-numeric-v1",
          },
        },
        {
          id: "sf-2",
          kind: "table_row",
          sourceId: "kap-doc",
          field: "Olağanüstü Yedekler",
          value: "3.352.908.083 / 3.850.000.000",
          confidence: "high",
          provenance: {
            quote: "Olağanüstü Yedekler 3.352.908.083 3.850.000.000",
            extractor: "table-numeric-v1",
          },
        },
      ],
    });

    expect(rendered).toContain("- Dağıtılması Öngörülen Diğer Kaynaklar: 3.352.908.083");
    expect(rendered).toContain("- Olağanüstü Yedekler: 3.352.908.083");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("uses a natural brief answer when the user asks for a short calm explanation", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "medical",
      answerIntent: "steps",
      groundingConfidence: "high",
      userQuery: "Smear sonucum temiz ama kasıklarım ağrıyor. Kısa ve sakin açıkla.",
      tone: "calm",
      sections: ["assessment", "action", "caution", "summary"],
      assessment: "Temiz smear sonucu tek başına ara ara kasık ağrısının nedenini açıklamaz.",
      action: "Ağrı sürerse veya artarsa jinekoloji değerlendirmesi planlanmalıdır.",
      caution: ["Şiddetli ağrı, ateş, yoğun kanama veya bayılma varsa daha hızlı başvuru gerekir."],
      summary: "Smear temiz olsa da devam eden ağrı ayrıca değerlendirilmelidir.",
      unknowns: [],
      sourceIds: ["clinical-card-1"],
      facts: [
        "Smear sonucu temiz olsa bile kasık ağrısı farklı nedenlerle ilişkili olabilir.",
        "Ağrı sürerse veya artarsa jinekoloji değerlendirmesi planlanmalıdır.",
      ],
    });

    expect(rendered).toContain("Temiz smear sonucu");
    expect(rendered).toContain("jinekoloji değerlendirmesi");
    expect(rendered).toContain("Dikkat edilmesi gereken nokta:");
    expect(rendered).not.toContain("Kısa plan:");
    expect(rendered).not.toContain("1.");
  });

  it("uses task-aware list composition for newly ingested lesson notes without medical labels", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "general",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery: "Büyük verinin 5V özelliğini sadece madde madde yaz. Her madde en fazla 1 cümle olsun.",
      tone: "direct",
      sections: ["assessment", "summary"],
      assessment: "Büyük veri için 5V kuralı hacim, hız, çeşitlilik, doğruluk ve değer başlıklarıyla açıklanır.",
      action: "Volume veri miktarını, Velocity veri üretim hızını, Variety veri türlerini, Veracity veri güvenilirliğini, Value ise elde edilen faydayı ifade eder.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "5V, büyük veriyi tanımlamak için kullanılan temel özelliklerdir.",
      unknowns: [],
      sourceIds: ["lesson-big-data"],
      facts: [
        "Volume veri miktarını ifade eder.",
        "Velocity verinin üretilme ve işlenme hızını ifade eder.",
        "Variety farklı veri türlerini ifade eder.",
        "Veracity verinin doğruluğu ve güvenilirliğiyle ilgilidir.",
        "Value veriden elde edilen faydayı ifade eder.",
      ],
    });

    expect(rendered).toContain("- Volume");
    expect(rendered).toContain("- Velocity");
    expect(rendered).not.toContain("Ne zaman doktora");
    expect(rendered).not.toContain("Dikkat");
  });

  it("renders definition tasks as concise source-grounded definitions", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "technical",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery: "Sistem bileşeni nedir? Kaynağa göre kısa açıkla.",
      tone: "direct",
      sections: ["assessment", "summary"],
      assessment:
        "Sistem bileşeni; bir sistemin çalışması için veri toplama, işleme, saklama ve çıktı üretme gibi görevlerden birini üstlenen parçadır. Bu konu daha uzun örneklerle açıklanır.",
      action:
        "Bu tanımı kullanırken kaynakta belirtilmeyen ek risk, tavsiye veya uygulama adımı eklenmemelidir.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary:
        "Sistem bileşenleri birlikte çalışarak sistem davranışını oluşturur ve farklı görevleri paylaşır.",
      unknowns: [],
      sourceIds: ["generic-source"],
      facts: [
        "Sistem bileşeni; bir sistemin çalışması için belirli bir görevi üstlenen parçadır.",
      ],
    });

    expect(rendered).toContain("Sistem bileşeni");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("Bu konu daha uzun örneklerle");
    expect(rendered.split(/\s+/u).filter(Boolean).length).toBeLessThanOrEqual(36);
  });

  it("renders typed list evidence as concise bullets without repeating long source prose", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "general",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery: "Sistemin temel bileşenleri nelerdir?",
      tone: "direct",
      sections: ["assessment", "summary"],
      assessment:
        "Bir sistemin temel bileşenleri başlığı altında sensörlerden başlayan uzun bir açıklama, örnekler ve kapanış notlarıyla birlikte anlatılır.",
      action: "Kaynakta listelenen maddeler kısa yazılmalıdır.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Bileşenler kaynakta madde madde verilmiştir.",
      unknowns: [],
      sourceIds: ["generic-list-source"],
      facts: [
        "Algılama: Ortamdan veri toplar ve bu açıklama örneklerle, notlarla, uzun kaynak bağlamıyla gereksiz şekilde devam eder.",
        "Bağlantı: Veriyi merkeze iletir.",
        "İşleme: Gelen veriyi analiz eder.",
        "Arayüz: Sonucu kullanıcıya gösterir.",
      ],
    });

    expect(rendered).toContain("- Algılama:");
    expect(rendered).toContain("- Bağlantı:");
    expect(rendered).toContain("- İşleme:");
    expect(rendered).toContain("- Arayüz:");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered.split(/\s+/u).length).toBeLessThanOrEqual(90);
  });

  it("composePlannedAnswer renders procedure tasks as concise numbered evidence steps without generic caution", () => {
    const answerSpec: AnswerSpec = {
      answerDomain: "technical",
      answerIntent: "steps",
      groundingConfidence: "high",
      userQuery: "Kaynağa göre kayıt ekleme işlemi nasıl yapılıyor?",
      tone: "direct",
      sections: ["assessment", "action", "summary"],
      assessment: "Kayıt ekleme işlemi kaynakta kontrol, ekleme ve temizleme adımlarıyla anlatılır.",
      action: "Girdi uzunluğu kontrol edilir; geçerliyse değer listeye eklenir; giriş alanı temizlenir; odak tekrar giriş alanına verilir.",
      caution: ["Yedeksiz işlem, belirsiz rollback veya veri silen komutlar yüksek risklidir."],
      summary: "İşlem kaynakta kısa bir kullanıcı etkileşimi akışı olarak gösterilir.",
      unknowns: [],
      sourceIds: ["generic-procedure-source"],
      facts: [
        "Girdi uzunluğu kontrol edilir.",
        "Geçerliyse değer listeye eklenir.",
        "Giriş alanı temizlenir.",
        "Odak tekrar giriş alanına verilir.",
      ],
    };
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        usableFactCount: answerSpec.facts.length,
      }),
      constraints: answerPlan.constraints,
    });

    expect(rendered).toContain("1. Girdi uzunluğu");
    expect(rendered).toContain("2. Geçerliyse değer");
    expect(rendered).toContain("4. Odak tekrar");
    expect(rendered).not.toContain("Kısa plan:");
    expect(rendered).not.toContain("Yedeksiz işlem");
  });

  it("uses source-grounded compare composition without adding unrelated caution", () => {
    const rendered = composeAnswerSpec({
      answerDomain: "general",
      answerIntent: "compare",
      groundingConfidence: "high",
      userQuery: "IoT cihazı ile akıllı cihaz aynı şey mi? Kaynağa göre farkını açıkla.",
      tone: "direct",
      sections: ["assessment", "summary"],
      assessment: "Kaynağa göre her IoT cihazı akıllıdır ama her akıllı cihaz IoT değildir.",
      action: "İnternete bağlı ve uzaktan veri alışverişi yapıyorsa IoT cihazı sayılır; yalnız önceden programlı çalışıyorsa sadece akıllı cihaz olabilir.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Temel fark internet bağlantısı ve veri alışverişi yapabilmesidir.",
      unknowns: [],
      sourceIds: ["lesson-iot"],
      facts: [
        "Her IoT cihazı akıllıdır ama her akıllı cihaz IoT değildir.",
        "Telefondan kontrol ediliyorsa ve internete bağlıysa IoT cihazıdır.",
      ],
    });

    expect(rendered).toContain("her IoT cihazı");
    expect(rendered).toContain("internet bağlantısı");
    expect(rendered).not.toContain("Ne zaman doktora");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("composePlannedAnswer renders selected structured facts before generic safety prose", () => {
    const answerSpec: AnswerSpec = {
      answerDomain: "finance",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery:
        "EREGL kar payında dağıtılması öngörülen diğer kaynaklar ve olağanüstü yedekler nedir? Sadece rakamları kısa maddelerle yaz, risk yorumu ekleme.",
      tone: "direct",
      sections: ["assessment", "action", "summary"],
      assessment: "Kaynakta ilgili KAP tablo satırları var.",
      action: "Sadece sorulan tablo değerleri yazılmalıdır.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Sorulan alanlar KAP tablosundan alınmalıdır.",
      unknowns: [],
      sourceIds: ["kap-doc"],
      facts: [],
      structuredFacts: [
        {
          id: "sf-1",
          kind: "table_row",
          sourceId: "kap-doc",
          field: "Dağıtılması Öngörülen Diğer Kaynaklar",
          value: "3.352.908.083 / 3.850.000.000",
          confidence: "high",
          provenance: {
            quote: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 3.850.000.000",
            extractor: "table-numeric-v1",
          },
        },
        {
          id: "sf-2",
          kind: "table_row",
          sourceId: "kap-doc",
          field: "Olağanüstü Yedekler",
          value: "3.352.908.083 / 3.850.000.000",
          confidence: "high",
          provenance: {
            quote: "Olağanüstü Yedekler 3.352.908.083 3.850.000.000",
            extractor: "table-numeric-v1",
          },
        },
      ],
    };
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 2,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("- Dağıtılması Öngörülen Diğer Kaynaklar: 3.352.908.083");
    expect(rendered).toContain("- Olağanüstü Yedekler: 3.352.908.083");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("composePlannedAnswer uses the provided answer plan for concise definition rendering", () => {
    const answerSpec: AnswerSpec = {
      answerDomain: "general",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery: "Sistem bileşeni nedir? Kaynağa göre kısa açıkla.",
      tone: "direct",
      sections: ["assessment", "action", "summary"],
      assessment:
        "Sistem bileşeni; bir sistemin çalışması için veri toplama, işleme, saklama ve çıktı üretme gibi görevlerden birini üstlenen parçadır. Kaynak bunu uzun örneklerle sürdürüyor.",
      action:
        "Bu tanımı kullanırken kaynakta belirtilmeyen ek risk, tavsiye veya uygulama adımı eklenmemelidir.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary:
        "Sistem bileşenleri birlikte çalışarak sistem davranışını oluşturur ve farklı görevleri paylaşır.",
      unknowns: [],
      sourceIds: ["generic-source"],
      facts: [
        "Sistem bileşeni; bir sistemin çalışması için belirli bir görevi üstlenen parçadır.",
      ],
      structuredFacts: [],
    };
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        usableFactCount: 1,
      }),
      constraints: {
        maxWords: 50,
        forbidCaution: false,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Sistem bileşeni");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("Kaynak bunu uzun örneklerle");
    expect(rendered.split(/\s+/u).filter(Boolean).length).toBeLessThanOrEqual(36);
  });

  it("composePlannedAnswer renders partial field extraction from text facts before missing-field fallback", () => {
    const answerSpec = genericFieldAnswerSpec();
    const answerPlan = fieldExtractionPlan();
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        usableFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Required Metric kaynakta doğrulanmış");
    expect(rendered).toContain("Bulunamayan alanlar: Second Metric");
    expect(rendered).not.toContain("Kaynakta sorulan alanlar için tam değer bulunamadı");
  });

  it("composePlannedAnswer suppresses generic caution on the partial text fact path", () => {
    const answerSpec = genericFieldAnswerSpec({
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      facts: ["Required Metric için kaynakta doğrulanmış kısa açıklama vardır."],
    });
    const answerPlan = fieldExtractionPlan({
      outputFormat: "bullets",
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
        format: "bullets",
      },
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        usableFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("- Required Metric için kaynakta doğrulanmış kısa açıklama vardır.");
    expect(rendered).toContain("- Bulunamayan alanlar: Second Metric.");
    expect(rendered).not.toContain("Dikkat");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("composePlannedAnswer keeps structured facts ahead of partial text facts", () => {
    const answerSpec = genericFieldAnswerSpec({
      facts: ["Required Metric metin fact olarak farklı bir ifadeyle geçiyor."],
      structuredFacts: [
        {
          id: "sf-generic-1",
          kind: "text_claim",
          sourceId: "generic-source",
          field: "Required Metric",
          value: "Structured Value",
          confidence: "high",
          provenance: {
            quote: "Required Metric Structured Value",
            extractor: "generic-structured-test",
          },
        },
      ],
    });
    const answerPlan = fieldExtractionPlan({
      selectedFacts: answerSpec.structuredFacts,
      coverage: "partial",
      diagnostics: {
        requestedFieldCount: 2,
        selectedFactCount: 1,
        missingFieldIds: ["second_metric"],
      },
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        structuredFacts: answerSpec.structuredFacts,
        usableFactCount: 1,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Required Metric: Structured Value");
    expect(rendered).toContain("Bulunamayan alanlar: second_metric");
    expect(rendered).not.toContain("metin fact olarak");
  });

  it("composePlannedAnswer prefers readable requested labels over normalized fact labels", () => {
    const answerSpec: AnswerSpec = {
      answerDomain: "general",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery: "Kaynağa göre “Dağıtılması Öngörülen Diğer Kaynaklar” değerini madde olarak yaz.",
      tone: "direct",
      sections: ["assessment", "summary"],
      assessment: "Kaynakta ilgili tablo satırı var.",
      action: "Sadece sorulan değer yazılmalıdır.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Sorulan alan tablodan alınmalıdır.",
      unknowns: [],
      sourceIds: ["doc-1"],
      facts: [],
      structuredFacts: [
        {
          id: "sf-readable-label",
          kind: "table_row",
          sourceId: "doc-1",
          field: "dagitilmasi ongorulen diger kaynaklar",
          value: "3.352.908.083",
          confidence: "high",
          provenance: {
            quote: "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083",
            extractor: "generic-table-row-v1",
          },
        },
      ],
    };
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Dağıtılması Öngörülen Diğer Kaynaklar");
    expect(rendered).not.toContain("dagitilmasi ongorulen");
    expect(rendered).not.toContain("risk koşulu");
  });

  it("composePlannedAnswer recovers readable row labels from raw row text", () => {
    const answerSpec = genericFieldAnswerSpec({
      facts: [],
      structuredFacts: [
        {
          id: "sf-readable-row",
          kind: "table_row",
          sourceId: "generic-source",
          field: "olcum degeri",
          value: "123",
          confidence: "high",
          table: {
            rowLabel: "olcum degeri",
            rawRow: "Ölçüm Değeri 123",
          },
          provenance: {
            quote: "Ölçüm Değeri 123",
            extractor: "generic-table-row-v1",
          },
        },
      ],
    });
    const answerPlan = fieldExtractionPlan({
      selectedFacts: answerSpec.structuredFacts,
      coverage: "partial",
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Ölçüm Değeri: 123");
    expect(rendered).not.toContain("olcum degeri: 123");
  });

  it("composePlannedAnswer strips source prefixes before recovering readable row labels", () => {
    const answerSpec = genericFieldAnswerSpec({
      facts: [],
      structuredFacts: [
        {
          id: "sf-prefixed-row",
          kind: "table_row",
          sourceId: "generic-source",
          field: "kaynak alani",
          value: "456",
          confidence: "high",
          table: {
            rowLabel: "kaynak alani",
            rawRow: "generic-file.pdf: Kaynak Alanı 456",
          },
          provenance: {
            quote: "generic-file.pdf: Kaynak Alanı 456",
            extractor: "generic-table-row-v1",
          },
        },
      ],
    });
    const answerPlan = fieldExtractionPlan({
      selectedFacts: answerSpec.structuredFacts,
      coverage: "partial",
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Kaynak Alanı: 456");
    expect(rendered).not.toContain("generic-file.pdf");
  });

  it("composePlannedAnswer recovers only the matching label span from noisy table rows", () => {
    const answerSpec = genericFieldAnswerSpec({
      facts: [],
      structuredFacts: [
        {
          id: "sf-noisy-row",
          kind: "table_row",
          sourceId: "generic-source",
          field: "olcum degeri",
          value: "123",
          confidence: "high",
          table: {
            rowLabel: "olcum degeri",
            rawRow: "Başlık A Başlık B İlk Alan 111 - Ölçüm Değeri 123",
          },
          provenance: {
            quote: "Başlık A Başlık B İlk Alan 111 - Ölçüm Değeri 123",
            extractor: "generic-table-row-v1",
          },
        },
      ],
    });
    const answerPlan = fieldExtractionPlan({
      selectedFacts: answerSpec.structuredFacts,
      coverage: "partial",
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("Ölçüm Değeri: 123");
    expect(rendered).not.toContain("Başlık A Başlık B");
    expect(rendered).not.toContain("İlk Alan");
  });

  it("composePlannedAnswer falls back to existing row labels when recovery fails", () => {
    const answerSpec = genericFieldAnswerSpec({
      facts: [],
      structuredFacts: [
        {
          id: "sf-fallback-row",
          kind: "table_row",
          sourceId: "generic-source",
          field: "fallback label",
          value: "value without numeric anchor",
          confidence: "high",
          table: {
            rowLabel: "fallback label",
            rawRow: "Unrelated source text without a matching value",
          },
          provenance: {
            quote: "Unrelated source text without a matching value",
            extractor: "generic-table-row-v1",
          },
        },
      ],
    });
    const answerPlan = fieldExtractionPlan({
      selectedFacts: answerSpec.structuredFacts,
      coverage: "partial",
    });
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        structuredFacts: answerSpec.structuredFacts,
        structuredFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("fallback label: value without numeric anchor");
  });

  it("composePlannedAnswer does not mine finance table strings unless fallback is explicitly enabled", () => {
    const answerSpec: AnswerSpec = {
      answerDomain: "finance",
      answerIntent: "explain",
      groundingConfidence: "high",
      userQuery:
        "EREGL kar payında dağıtılması öngörülen diğer kaynaklar nedir? Sadece rakamı yaz, risk yorumu ekleme.",
      tone: "direct",
      sections: ["assessment", "action", "summary"],
      assessment: "Kaynakta ilgili KAP tablo satırları var.",
      action: "Sadece sorulan tablo değeri yazılmalıdır.",
      caution: ["Kaynakta özel alarm veya risk koşulu açıkça belirtilmemiş."],
      summary: "Sorulan alan KAP tablosundan alınmalıdır.",
      unknowns: [],
      sourceIds: ["kap-doc"],
      facts: [
        "Dağıtılması Öngörülen Diğer Kaynaklar 3.352.908.083 3.850.000.000",
      ],
      structuredFacts: [],
    };
    const answerPlan = buildAnswerPlan(answerSpec);
    const rendered = composePlannedAnswer({
      answerSpec,
      answerPlan,
      compiledEvidence: compiledEvidence({
        facts: answerSpec.facts,
        usableFactCount: 1,
      }),
      constraints: {
        forbidCaution: true,
        noRawTableDump: true,
        sourceGroundedOnly: true,
      },
    });

    expect(rendered).toContain("tam değer bulunamadı");
    expect(rendered).not.toContain("3.352.908.083");
  });
});
