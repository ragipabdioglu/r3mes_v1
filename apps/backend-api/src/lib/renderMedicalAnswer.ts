import type { GroundedMedicalAnswer } from "./answerSchema.js";
import { polishAnswerText } from "./answerQuality.js";
import { getDomainPolicy } from "./domainPolicy.js";

const BLOCKED_PHRASES = [
  "CA-125",
  "ca125",
  "kesin kanser",
  "kanser olabilir",
  "tekrar smear yaptır",
  "patolojik incelik",
  "her zaman acil",
];

function firstOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join("; ") : fallback;
}

function stripBlockedSentences(text: string, blockedPhrases: string[]): string {
  const blocked = blockedPhrases.map((item) => item.toLocaleLowerCase("tr-TR"));
  const pieces = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((sentence) => {
      const normalized = sentence.toLocaleLowerCase("tr-TR");
      return !blocked.some((phrase) => normalized.includes(phrase));
    });
  return pieces.join(" ").trim();
}

function cleanText(value: string, fallback: string, avoidInference: string[]): string {
  const blocked = [...BLOCKED_PHRASES, ...avoidInference];
  const cleaned = polishAnswerText(stripBlockedSentences(value, blocked));
  return cleaned || fallback;
}

function hasAny(text: string, terms: string[]): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return terms.some((term) => normalized.includes(term.toLocaleLowerCase("tr-TR")));
}

function lowerFirstForSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return `${trimmed.charAt(0).toLocaleLowerCase("tr-TR")}${trimmed.slice(1)}`;
}

function softenMedicalOverUrgency(text: string): string {
  return text
    .replace(/Hafif kasık ağrısına her zaman acil bir tıbbi değerlendirme yapmayınız\.?/giu, "Hafif ve kısa süreli kasık ağrısı izlenebilir; ağrı sürer, artar veya alarm bulgusu eklenirse değerlendirme planlanmalıdır.")
    .replace(/Hafif kasık ağrısına acil bir tıbbi değerlendirme yapmayınız\.?/giu, "Hafif ve kısa süreli kasık ağrısı izlenebilir; ağrı sürer veya artarsa değerlendirme planlanmalıdır.");
}

function inferTemplate(answer: GroundedMedicalAnswer): {
  assessment: string;
  action: string;
  visitTriggers: string[];
  summary: string;
} | null {
  const haystack = [
    answer.user_query,
    answer.condition_context,
    answer.safe_action,
    answer.general_assessment,
    answer.recommended_action,
    answer.one_sentence_summary,
    answer.short_summary,
  ].join(" ");

  if (hasAny(haystack, ["patoloji"])) {
    return {
      assessment: "Patoloji sonucu tek başına panikle yorumlanmamalı, sonucu isteyen doktorla birlikte değerlendirilmelidir.",
      action: "Patoloji sonucunu doktorunuzla görüşüp takip veya tedavi gerekip gerekmediğini netleştirin.",
      visitTriggers: ["Şiddetli ağrı, yoğun kanama, ateş veya hızla kötüleşen yakınma varsa daha hızlı başvurun."],
      summary: "İlk adım patoloji sonucunu doktorla birlikte açıklığa kavuşturmaktır.",
    };
  }

  if (hasAny(answer.user_query, ["menopoz"]) && hasAny(answer.user_query, ["kanama", "lekelenme"])) {
    return {
      assessment: "Menopoz sonrası kanama veya lekelenme beklenerek geçiştirilecek bir durum değildir.",
      action: "Bir kez olmuş olsa bile kadın hastalıkları uzmanı tarafından değerlendirilmelidir.",
      visitTriggers: ["Kanama tekrarlarsa, artarsa, ağrı veya halsizlik eşlik ederse daha hızlı başvurun."],
      summary: "Menopoz sonrası kanama veya lekelenme için değerlendirme planlamak doğru yaklaşımdır.",
    };
  }

  if (
    hasAny(answer.user_query, ["gebelik", "hamile"]) &&
    hasAny(answer.user_query, ["test", "negatif"]) &&
    hasAny(answer.user_query, ["kasık", "kasik", "ağrı", "agri"])
  ) {
    return {
      assessment: "Negatif gebelik testi gebelik olasılığını azaltır, ancak kasık ağrısı ve gecikme gibi yakınmaları tek başına açıklamaz.",
      action: "Adet gecikmesi sürerse gebelik testinin tekrarı ve kadın hastalıkları muayenesiyle durum yeniden değerlendirilmelidir.",
      visitTriggers: ["Şiddetli kasık ağrısı, bayılma, yoğun kanama, ateş veya kusma olursa daha hızlı başvurun."],
      summary: "Negatif test rahatlatıcıdır; kasık ağrısı veya gecikme sürerse test ve muayene ile netleştirmek gerekir.",
    };
  }

  if (hasAny(haystack, ["kist", "yumurtalık"]) && hasAny(haystack, ["şiddetli", "ani", "birden", "ağrı", "beklemeli"])) {
    return {
      assessment: "Kist varlığında ani veya şiddetli kasık ağrısı daha hızlı değerlendirme gerektirebilir.",
      action: "Kistiniz varken ağrı belirgin başladıysa veya artıyorsa beklemek yerine tıbbi değerlendirme planlanmalıdır.",
      visitTriggers: ["Ani ve şiddetli kasık ağrısı, bayılma, kusma veya ateş olursa hızlı değerlendirme gerekir."],
      summary: "Kist ve şiddetli ağrı birlikteyse kontrol geciktirilmemelidir.",
    };
  }

  if (hasAny(answer.user_query, ["karn", "karın", "karin", "mide", "göbek", "gobek"]) && hasAny(answer.user_query, ["ağrı", "agri", "sancı", "sanci"])) {
    return {
      assessment: "Karın ağrısı tek başına kesin bir tanı göstermez; yeri, şiddeti, süresi ve eşlik eden belirtiler önemlidir.",
      action: "Ağrı hafifse dinlenip sıvı alarak izlenebilir; ağrı tekrarlıyor, artıyor veya günlük yaşamı etkiliyorsa tıbbi değerlendirme planlanmalıdır.",
      visitTriggers: [
        "Şiddetli veya giderek artan ağrı, ateş, kusma, bayılma, karında sertlik, kanlı dışkı, gebelik şüphesi veya anormal vajinal kanama varsa gecikmeden başvurun.",
      ],
      summary: "Hafif ve kısa süren ağrı izlenebilir; alarm bulgusu veya devam eden ağrı varsa muayene gerekir.",
    };
  }

  if (
    hasAny(answer.user_query, ["smear"]) &&
    hasAny(answer.user_query, ["akıntı", "akinti"])
  ) {
    return {
      assessment: "Normal smear sonucu iyi bir bulgudur, ancak akıntının nedenini tek başına açıklamaz.",
      action: "Akıntı sürüyorsa, kötü koku, kaşıntı veya ağrı eşlik ediyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Ateş, kasık ağrısı, kötü kokulu akıntı veya anormal kanama olursa daha hızlı başvurun."],
      summary: "Smear normal olsa bile devam eden akıntı kontrol ile değerlendirilmelidir.",
    };
  }

  if (
    hasAny(answer.user_query, ["smear"]) &&
    hasAny(answer.user_query, ["kasık", "kasik"]) &&
    hasAny(answer.user_query, ["ağrı", "agri", "sancı", "sanci"])
  ) {
    return {
      assessment: "Smear sonucunun temiz olması iyi bir bulgudur, ancak kasık ağrısının tüm nedenlerini tek başına açıklamaz.",
      action: "Ağrı tekrarlıyor, sürüyor veya günlük yaşamı etkiliyorsa kadın hastalıkları muayenesi planlanmalıdır.",
      visitTriggers: ["Şiddetli ağrı, ateş, anormal kanama, bayılma, kusma veya ağrının hızla artması olursa daha hızlı başvurun."],
      summary: "Temiz smear rahatlatıcıdır; devam eden kasık ağrısı muayene ile değerlendirilmelidir.",
    };
  }

  if (hasAny(answer.user_query, ["kasık", "kasik"]) && hasAny(answer.user_query, ["ağrı", "agri", "sancı", "sanci"])) {
    return {
      assessment: "Kasık ağrısında ağrının şiddeti, süresi, adet/gebelik durumu ve eşlik eden belirtiler önemlidir.",
      action: "Ağrı tekrarlıyor, sürüyor veya günlük yaşamı etkiliyorsa kadın hastalıkları muayenesi planlanmalıdır.",
      visitTriggers: [
        "Şiddetli ağrı, ateş, kötü kokulu akıntı, anormal kanama, bayılma, kusma veya ağrının hızla artması olursa daha hızlı başvurun.",
      ],
      summary: "Kasık ağrısı devam ediyorsa nedeni muayene ile netleştirilmelidir.",
    };
  }

  if (hasAny(answer.user_query, ["biyopsi", "parça"]) && hasAny(answer.user_query, ["kanama", "lekelenme", "temiz"])) {
    return {
      assessment: "Temiz biyopsi sonucu rahatlatıcıdır, ancak devam eden kanama veya lekelenme ayrıca değerlendirilmelidir.",
      action: "Kanama veya lekelenme sürerse kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Yoğun kanama, şiddetli ağrı, ateş veya kötüleşen yakınma varsa daha hızlı başvurun."],
      summary: "Temiz biyopsi iyi bir bulgudur; devam eden lekelenme kontrol ile netleşir.",
    };
  }

  if (hasAny(answer.user_query, ["smear"]) && hasAny(answer.user_query, ["kanama", "lekelenme", "adet dışı", "adet disi"])) {
    return {
      assessment: "Temiz veya normal smear sonucu iyi bir bulgudur, ancak adet dışı kanama veya lekelenmenin nedenini tek başına açıklamaz.",
      action: "Kanama tekrarlıyor, sürüyor veya miktarı artıyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Kanama artarsa, ağrı eşlik ederse, kötü kokulu akıntı olursa veya halsizlik gelişirse daha hızlı başvurun."],
      summary: "Temiz smear rahatlatıcıdır; devam eden kanama kontrol gerektirir.",
    };
  }

  if (hasAny(answer.user_query, ["kanama", "lekelenme", "adet dışı", "adet disi"])) {
    return {
      assessment: "Beklenmeyen kanama veya lekelenme tek başına kesin bir tanı anlamına gelmez, ancak değerlendirilmesi gereken bir yakınmadır.",
      action: "Kanama tekrarlıyor, sürüyor veya miktarı artıyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Yoğun kanama, bayılma, şiddetli ağrı, ateş veya gebelik şüphesi varsa daha hızlı başvurun."],
      summary: "Kanama yakınması sürerse kontrol ile nedeni netleştirilmelidir.",
    };
  }

  if (hasAny(haystack, ["smear"]) && hasAny(haystack, ["kasık", "ağrı", "ağrısı"])) {
    return {
      assessment: "Smear sonucunun temiz olması iyi bir bulgudur, ancak kasık ağrısının tüm nedenlerini tek başına açıklamaz.",
      action: "Ağrı tekrarlıyor, sürüyor veya günlük yaşamı etkiliyorsa kadın hastalıkları muayenesi planlanmalıdır.",
      visitTriggers: ["Şiddetli ağrı, ateş, anormal kanama, bayılma, kusma veya ağrının hızla artması olursa daha hızlı başvurun."],
      summary: "Temiz smear rahatlatıcıdır; devam eden kasık ağrısı muayene ile değerlendirilmelidir.",
    };
  }

  if (hasAny(haystack, ["smear"]) && hasAny(haystack, ["akıntı", "akinti"])) {
    return {
      assessment: "Normal smear sonucu iyi bir bulgudur, ancak akıntının nedenini tek başına açıklamaz.",
      action: "Akıntı sürüyorsa, kötü koku, kaşıntı veya ağrı eşlik ediyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Ateş, kasık ağrısı, kötü kokulu akıntı veya anormal kanama olursa daha hızlı başvurun."],
      summary: "Smear normal olsa bile devam eden akıntı kontrol ile değerlendirilmelidir.",
    };
  }

  if (hasAny(haystack, ["asc-us", "ascus"])) {
    return {
      assessment: "ASC-US sonucu tek başına kanser anlamına gelmez.",
      action: "Sonuç, HPV durumu ve doktorun önerdiği kontrol planıyla birlikte değerlendirilmelidir.",
      visitTriggers: ["Anormal kanama, geçmeyen ağrı veya yeni belirti olursa kontrolü ertelemeyin."],
      summary: "ASC-US çoğu zaman takip ve kontrol gerektiren bir bulgudur; kesin yorum doktor değerlendirmesiyle yapılır.",
    };
  }

  if (hasAny(haystack, ["hpv"]) && hasAny(haystack, ["smear", "normal"])) {
    return {
      assessment: "HPV pozitifliği ve normal smear birlikte değerlendirildiğinde bu sonuç tek başına kanser tanısı anlamına gelmez.",
      action: "HPV tipi, smear sonucu, muayene bulguları ve doktorun önerdiği takip planı birlikte ele alınmalıdır.",
      visitTriggers: ["Anormal kanama, geçmeyen ağrı veya yeni belirti olursa kontrolü ertelemeyin."],
      summary: "HPV pozitifliği normal smear ile birlikte takip gerektirebilir; plan doktorla netleşir.",
    };
  }

  if (hasAny(haystack, ["biyopsi", "parça"]) && hasAny(haystack, ["kanama", "lekelenme", "temiz"])) {
    return {
      assessment: "Temiz biyopsi sonucu rahatlatıcıdır, ancak devam eden kanama veya lekelenme ayrıca değerlendirilmelidir.",
      action: "Kanama veya lekelenme sürerse kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Yoğun kanama, şiddetli ağrı, ateş veya kötüleşen yakınma varsa daha hızlı başvurun."],
      summary: "Temiz biyopsi iyi bir bulgudur; devam eden kanama kontrol ile netleşir.",
    };
  }

  if (hasAny(haystack, ["smear"]) && hasAny(haystack, ["kanama", "lekelenme", "temiz"])) {
    return {
      assessment: "Temiz smear sonucu iyi bir bulgudur, ancak lekelenme veya kanamanın nedenini tek başına açıklamaz.",
      action: "Lekelenme sürüyorsa veya tekrarlıyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Kanama artarsa, ağrı eşlik ederse, kötü kokulu akıntı olursa veya halsizlik gelişirse daha hızlı başvurun."],
      summary: "Temiz smear rahatlatıcıdır; devam eden lekelenme kontrol gerektirir.",
    };
  }

  if (hasAny(haystack, ["smear"]) && hasAny(haystack, ["panik", "yorum", "sonucumu", "sonucu"])) {
    return {
      assessment: "Smear sonucu tek başına panikle yorumlanmamalı, sonucu isteyen doktorla birlikte değerlendirilmelidir.",
      action: "Sonucun anlamını ve gerekirse takip planını doktorunuzla netleştirin.",
      visitTriggers: ["Anormal kanama, şiddetli ağrı veya yeni belirti varsa kontrolü ertelemeyin."],
      summary: "Smear sonucunu tek başına yorumlamak yerine doktor değerlendirmesiyle ilerlemek daha doğrudur.",
    };
  }

  if (hasAny(haystack, ["menopoz"]) && hasAny(haystack, ["kanama", "lekelenme"])) {
    return {
      assessment: "Menopoz sonrası kanama veya lekelenme beklenerek geçiştirilecek bir durum değildir.",
      action: "Bir kez olmuş olsa bile kadın hastalıkları uzmanı tarafından değerlendirilmelidir.",
      visitTriggers: ["Kanama tekrarlarsa, artarsa, ağrı veya halsizlik eşlik ederse daha hızlı başvurun."],
      summary: "Menopoz sonrası kanama veya lekelenme için kontrol planlamak doğru yaklaşımdır.",
    };
  }

  if (hasAny(haystack, ["kist", "yumurtalık"])) {
    if (hasAny(haystack, ["şiddetli", "ani", "birden", "ağrı", "beklemeli"])) {
      return {
        assessment: "Kist varlığında ani veya şiddetli kasık ağrısı daha hızlı değerlendirme gerektirebilir.",
        action: "Ağrı belirgin başladıysa veya artıyorsa beklemek yerine tıbbi değerlendirme planlanmalıdır.",
        visitTriggers: ["Ani ve şiddetli kasık ağrısı, bayılma, kusma veya ateş olursa hızlı değerlendirme gerekir."],
        summary: "Kist ve şiddetli ağrı birlikteyse kontrol geciktirilmemelidir.",
      };
    }
    return {
      assessment: "Yumurtalık kisti görülmesi her zaman hemen ameliyat gerektiği anlamına gelmez.",
      action: "Kistin boyutu, görünümü, şikayetler ve doktor değerlendirmesine göre takip veya tedavi planlanır.",
      visitTriggers: ["Ani ve şiddetli kasık ağrısı, bayılma, kusma veya ateş olursa hızlı değerlendirme gerekir."],
      summary: "Kist için karar ultrason bulgusu ve muayene ile birlikte verilir.",
    };
  }

  if (hasAny(haystack, ["biyopsi", "parça"]) && hasAny(haystack, ["temiz", "güvenli", "guvenli", "endişe", "endise"])) {
    return {
      assessment: "Temiz biyopsi sonucu rahatlatıcıdır, ancak devam eden endişe veya şikayet doktorla birlikte değerlendirilmelidir.",
      action: "Sonucu isteyen doktorla görüşüp tekrar test veya takip gerekip gerekmediğini netleştirin.",
      visitTriggers: ["Yoğun kanama, şiddetli ağrı, ateş veya kötüleşen yakınma varsa daha hızlı başvurun."],
      summary: "Temiz biyopsi iyi bir bulgudur; sonraki adım doktorla takip planını netleştirmektir.",
    };
  }

  if (hasAny(haystack, ["ultrason"]) && hasAny(haystack, ["kitle", "kötü", "kotu"])) {
    return {
      assessment: "Ultrasonda geçen bir ifade tek başına kesin kötü huylu hastalık anlamına gelmez.",
      action: "Ultrason bulgusunun anlamı, muayene ve gerekirse ek değerlendirmeyle doktor tarafından netleştirilmelidir.",
      visitTriggers: ["Şiddetli ağrı, hızlı büyüyen şişlik, anormal kanama veya genel durumda bozulma olursa daha hızlı başvurun."],
      summary: "Ultrason sonucunu tek başına yorumlamak yerine doktor değerlendirmesiyle ilerlemek gerekir.",
    };
  }

  if (
    hasAny(answer.user_query, ["gebelik", "hamile"]) &&
    hasAny(answer.user_query, ["test", "negatif"]) &&
    hasAny(answer.user_query, ["kasık", "kasik", "ağrı", "agri"])
  ) {
    return {
      assessment: "Negatif gebelik testi gebelik olasılığını azaltır, ancak adet gecikmesi ve kasık ağrısının nedenini tek başına açıklamaz.",
      action: "Adet gecikmesi sürerse gebelik testinin tekrarı ve kadın hastalıkları muayenesiyle durum yeniden değerlendirilmelidir.",
      visitTriggers: ["Şiddetli kasık ağrısı, bayılma, yoğun kanama, ateş veya kusma olursa daha hızlı başvurun."],
      summary: "Negatif test rahatlatıcıdır; gecikme veya ağrı sürerse test ve muayene ile netleştirmek gerekir.",
    };
  }

  if (hasAny(haystack, ["kasık", "ağrı", "ağrısı"]) && hasAny(haystack, ["ateş", "kanama", "şiddetli", "kusma", "acil", "belirti", "belirtiler", "hızlı doktora"])) {
    return {
      assessment: "Kasık ağrısında ağrının şiddeti, süresi ve eşlik eden belirtiler önemlidir.",
      action: "Ağrı tekrarlıyorsa veya günlük yaşamı etkiliyorsa kadın hastalıkları muayenesi planlanmalıdır.",
      visitTriggers: ["Şiddetli ağrı, ateş, kötü kokulu akıntı, anormal kanama, bayılma, kusma veya ağrının hızla artması olursa daha hızlı başvurun."],
      summary: "Kasık ağrısı alarm bulguları varsa bekletilmeden değerlendirilmelidir.",
    };
  }

  if (hasAny(haystack, ["hpv"])) {
    if (hasAny(answer.user_query, ["aşı", "asi", "aşısı", "aşısını", "aşısından"])) {
      return {
        assessment: "HPV aşısı kararı yaş, önceki aşı durumu ve kişisel risklere göre değerlendirilir.",
        action: "Aşı için uygunluğu kadın hastalıkları uzmanı veya aile hekimiyle görüşerek netleştirin.",
        visitTriggers: ["Anormal kanama, geçmeyen ağrı veya yeni belirti olursa ayrıca değerlendirme gerekir."],
        summary: "HPV aşısı konusunda en doğru karar kişisel değerlendirmeyle verilir.",
      };
    }
    return {
      assessment: "HPV pozitifliği tek başına kanser tanısı anlamına gelmez.",
      action: "Sonuç, smear/HPV tipi ve muayene bulgularıyla birlikte doktor tarafından takip planına bağlanmalıdır.",
      visitTriggers: ["Anormal kanama, geçmeyen ağrı veya yeni belirti olursa kontrolü ertelemeyin."],
      summary: "HPV sonucunda panik yerine düzenli takip ve doktor değerlendirmesi esastır.",
    };
  }

  if (hasAny(haystack, ["kanama", "lekelenme"]) && hasAny(haystack, ["smear", "temiz", "normal"])) {
    return {
      assessment: "Temiz veya normal smear sonucu iyi bir bulgudur, ancak adet dışı kanama veya lekelenmenin nedenini tek başına açıklamaz.",
      action: "Kanama tekrarlıyorsa veya sürüyorsa kadın hastalıkları kontrolü planlanmalıdır.",
      visitTriggers: ["Kanama artarsa, ağrı eşlik ederse, kötü kokulu akıntı olursa veya halsizlik gelişirse daha hızlı başvurun."],
      summary: "Normal smear rahatlatıcıdır; devam eden kanama kontrol gerektirir.",
    };
  }

  return null;
}

export function renderGroundedMedicalAnswer(
  answer: GroundedMedicalAnswer,
  opts: { useFallbackTemplate?: boolean } = {},
): string {
  const naturalAnswer = answer.answer?.trim() ?? "";
  if (!opts.useFallbackTemplate && naturalAnswer) {
    return cleanText(
      naturalAnswer,
      answer.grounding_confidence === "low"
        ? "Eldeki bilgi sınırlı; kesin konuşmadan, kaynaklara bağlı kalmak gerekir."
        : "Kaynaklara göre kısa ve temkinli ilerlemek gerekir.",
      answer.avoid_inference,
    );
  }

  const confidenceNote =
    answer.grounding_confidence === "low"
      ? "Eldeki dayanak sınırlı."
      : answer.grounding_confidence === "medium"
        ? "Bilgi kısmen yeterli."
        : "Bilgi dayanağı yeterli görünüyor.";

  const policy = getDomainPolicy(answer.answer_domain);
  const template = opts.useFallbackTemplate ? inferTemplate(answer) : null;
  const assessment = template?.assessment ?? cleanText(
    answer.condition_context || answer.general_assessment,
    confidenceNote,
    answer.avoid_inference,
  );
  const action = template?.action ?? cleanText(
    answer.safe_action || answer.recommended_action,
    answer.grounding_confidence === "low"
      ? "Bu bilgiyle kesin çıkarım yapmak doğru olmaz; yakınma sürerse uygun bir muayene planlanmalıdır."
      : "Yakınma sürerse uygun bir muayene planı yapılmalıdır.",
    answer.avoid_inference,
  );
  const visitTriggers = template?.visitTriggers ?? (answer.visit_triggers.length > 0 ? answer.visit_triggers : answer.red_flags.length > 0 ? answer.red_flags : answer.doctor_visit_when);
  const summary = template?.summary ?? cleanText(
    answer.one_sentence_summary || answer.short_summary,
    "Mevcut bilgiyle kısa ve temkinli takip uygundur.",
    answer.avoid_inference,
  );

  if (!opts.useFallbackTemplate) {
    const caution = firstOrFallback(
      visitTriggers,
      answer.answer_domain === "medical"
        ? "Şikâyet sürerse, artarsa veya yeni belirti eklenirse değerlendirme gerekir."
        : "Kaynak yetersizse veya kararın sonucu önemliyse uzman desteği alınmalıdır.",
    );
    const cleanAssessment = softenMedicalOverUrgency(assessment);
    const cleanAction = softenMedicalOverUrgency(action);
    const cleanSummary = softenMedicalOverUrgency(summary);

    if (answer.answer_intent === "reassure") {
      return [
        `${cleanAssessment} Bu sonuç tek başına panik gerektiren bir anlam taşımaz; yine de devam eden ağrı ayrı değerlendirilmelidir.`,
        `Yakınma sürer, artar veya günlük yaşamı etkilerse ${lowerFirstForSentence(cleanAction)}`,
        `Daha hızlı başvuru gerektirebilecek durumlar: ${caution}`,
      ].join("\n");
    }

    if (answer.answer_intent === "steps") {
      return [
        `Kısa plan: ${cleanAction}`,
        `Takip ederken şunu akılda tutun: ${cleanAssessment}`,
        `Beklemeden değerlendirme gerektiren durumlar: ${caution}`,
      ].join("\n");
    }

    if (answer.answer_intent === "triage") {
      return [
        `Önce risk açısından bakın: ${caution}`,
        `Bu bulgular yoksa kaynaklara göre durum: ${cleanAssessment}`,
        `Uygun adım: ${cleanAction}`,
      ].join("\n");
    }

    if (answer.answer_intent === "explain") {
      return [
        `${cleanAssessment}`,
        `Pratik anlamı: ${cleanAction}`,
        `Özet: ${cleanSummary}`,
      ].join("\n");
    }
  }

  const sections = [
    `1. ${policy.answerLabels.assessment}: ${softenMedicalOverUrgency(assessment)}`,
    `2. ${policy.answerLabels.action}: ${softenMedicalOverUrgency(action)}`,
    `3. ${policy.answerLabels.caution}: ${firstOrFallback(
      visitTriggers,
      answer.answer_domain === "medical"
        ? "Şikâyet sürerse, artarsa veya yeni belirti eklenirse değerlendirme gerekir."
        : "Kaynak yetersizse veya kararın sonucu önemliyse uzman desteği alınmalıdır.",
    )}`,
    `4. ${policy.answerLabels.summary}: ${softenMedicalOverUrgency(summary)}`,
  ];

  return sections.join("\n");
}
