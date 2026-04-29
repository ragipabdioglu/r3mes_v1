Benchmark neyi ölçüyor?
Bileşen	Gerçekte ölçülen
Görev tipi
Tek tur kısa cevap üretimi: her örnekte yalnızca {"role":"user","content": prompt} gidiyor; model çıktısı, sabit bir Türkçe referans cümlesi ile metin örtüşmesi üzerinden puanlanıyor.
Metrik
Örnek başına: 0,5 × ROUGE-L F1 + 0,5 × cümle BLEU (0–1), sonra ×100; tüm örneklerin aritmetik ortalaması → quality 0–100.
Kabul
quality >= score_threshold (varsayılan 75.0).
Yani benchmark “doğru mu?” veya “güvenli mi?” demiyor; referans cümleyle kelime/şablonda ne kadar örtüşüyor diyor. Özellikle kısa, tanım tarzı Türkçe ve referansla benzer sözcük dizilimi üreten çıktılar ödüllenir.

def aggregate_quality_0_100(samples: list[SampleScores]) -> float:
    """Örnekler üzerinde basit ortalama — 0-100 skor."""
    if not samples:
        return 0.0
    acc = 0.0
    for s in samples:
        combined_0_1 = 0.5 * s.rouge_l_f1 + 0.5 * s.bleu_0_1
        acc += combined_0_1 * 100.0
    return acc / len(samples)
Gizli set tamamen Türkçe, teknik-genel kültür (blokzincir, LoRA, IPFS):

[
  {
    "id": "tr-gen-1",
    "prompt": "Kısaca açıkla: blokzincir konsensüsü nedir?",
    "reference": "Blokzincir konsensüsü, dağıtık düğümlerin defter durumu üzerinde anlaşmasını sağlayan kurallar bütünüdür."
  },
  ...
]
ACTIVE için nasıl bir LoRA gerekir?
Dil: Modelin bu üç promptta Türkçe, kısa tanım üretmesi; mümkünse referanslarla yüksek lexical overlap (aynı kökler, benzer sıra).
Domain: “Genel” değil, bu ölçüde doğru olan: Türkçe kısa cevap / özet / bilgi soruları (instruction veya SFT) — teknik popüler bilgi dili.
Ne işe yarar: Taban modelin zaten ürettiği Türkçe tanım cümlelerini bozmayan veya referans tarzına iten LoRA (çok agresif domain kayması yok).
Zayıf aday: Yalnızca İngilizce, biyomedikal diyalog, uzun sohbet, farklı üslup (ör. madde madde, İngilizce karışık) — çıktı referans cümlelerden uzaklaştıkça ROUGE/BLEU düşer.
Özet: Benchmark “Türkçe, kısa, referans cümleyle örtüşen tanım” üretimini ödüllendiriyor; ACTIVE için aranacak LoRA tipi: Türkçe + kısa cevap hizalı, mümkünse benzer veri dağılımıyla eğitilmiş veya tabanı Türkçe talimatta güçlendiren adapter.

Hangi LoRA tipleri düşük ihtimalli?
Tip	Neden düşük ihtimal
İngilizce-ağırlıklı instruction LoRA
Çıktı İngilizce/çeviri kırığı → Türkçe referansla çakışma yok.
Dar domain (ör. biyomedikal BitNet adapter’ı)
Üretim alanı promptlardan sapabilir; skor düşer.
Çok küçük rank / güçlü stil kayması
Tabanın Türkçe tanımını bozuyorsa overlap düşer.
“Model” GGUF (general.type=model)
Zaten slot/LoRA yolunda uygun değil; ayrı konu.
Küçük base model zayıf mı?
Bu benchmark için evet, baraj yüksekse zorlanır. 0.5B sınıfı ve BitNet gibi modeller, tek tek cümleyle yüksek ROUGE/BLEU üretmekte zorlanabilir; eşik 75 ve 3 örnek ortalaması, pratikte yüksek lexical overlap ister. Sorun yalnızca LoRA değil: taban kapasitesi + çıktı biçimi + metrik.

Sonraki en iyi aday stratejisi (benchmark-temelli)
Arama: Aynı taban ailesi için Türkçe instruction / Türkçe QA / Türkçe özet LoRA’sı (HF’de “Turkish”, “tr”, kısa cevap veri setleri).
Eğitim (içeride): Gizli seti açık kullanmadan, benzer (Türkçe teknik kısa cevap + referans cümlesi) çiftlerle hafif SFT — ürün politikasına uygunsa.
Ürün parametresi: score_threshold veya metrik (ör. yalnızca ROUGE veya Türkçe stemmer) — ACTIVE oranını doğrudan değiştirir; bu “hangi LoRA?” sorusundan ayrı bir karar.
Hızlı teşhis: Aynı tabanda yalnız taban (LoRA ölçeği 0 veya LoRA yok denemesi) ile skor — taban tavana yakınsa LoRA ile ince ayar; taban çok düşükse daha büyük taban veya eşik/metrik tartışması.
Tek cümle: “Hangi LoRA’yı aramalıyız?”
Türkçe kısa bilgi/tanım üretimini güçlendiren, çıktıyı sabit referans cümlelerine lexical olarak yaklaştıran LoRA’yı arayın; İngilizce veya dar domain (ör. biyomedikal) adaptörler bu ROUGE/BLEU + 75 eşik kombinasyonunda ACTIVE ihtimalini düşürür.

---------

1. Backend’de ACTIVE/REJECTED ve skor nasıl yazılıyor?
Karar backend’de sayısal eşikle verilmez. POST /v1/internal/qa-reduction gövdesindeki status alanı tam eşleşme ile okunur: "approved" → ACTIVE, aksi → REJECTED. benchmarkScore her zaman webhook’taki score sayısı olarak yazılır.


internalQa.ts
Lines 70-110
    const approved = body.status === "approved";
    // ...
      const updated = await prisma.adapter.update({
        where: { id: adapter.id },
        data: {
          benchmarkScore: new Prisma.Decimal(body.score),
          status: approved ? AdapterStatus.ACTIVE : AdapterStatus.REJECTED,
        },
      });
Veritabanında saklananlar: Adapter.status, Adapter.benchmarkScore (Decimal). threshold Prisma’da yok; webhook şemasında isteğe bağlı alan olarak tanımlı olsa da backend bunu kaydetmiyor.

2. Eşik nerede? (ürün kararı worker tarafında)
QA worker, kalite skorunu hesaplar ve ortam değişkeni R3MES_SCORE_THRESHOLD (varsayılan 75.0) ile karşılaştırır; sonuç approved / rejected string’i ve score olarak webhook’a gider.


job_runner.py
Lines 113-115
    quality = aggregate_quality_0_100(sample_scores)
    approved = quality >= settings.score_threshold
    status = "approved" if approved else "rejected"

settings.py
Lines 28-29
    score_threshold: float = Field(default=75.0)
Webhook gönderilirken eşik değeri gövdeye eklenir (Fastify’ın kaydettiği alan değil; log/izlenebilirlik için):


job_runner.py
Lines 161-163
def _safe_webhook(settings: Settings, payload: dict[str, Any]) -> None:
    body = {**payload, "threshold": settings.score_threshold}
Özet: “Hangi sayıdan geçti?” sorusunun kanonik cevabı worker’daki R3MES_SCORE_THRESHOLD (varsayılan 75). Backend yalnızca gelen status + score’u yansıtır.

3. Yerel DB örneği (bu ortamda — pnpm / Prisma ile okundu)
id (kısa)	name	status	benchmarkScore	Yorum
…fna1
e2e-smoke
ACTIVE
88.5
e2e-lifecycle-smoke.mjs ile sabit score: 88.5 + status: "approved" — smoke, gerçek BitNet benchmark ürün koşusu değil.
…493w
BitNet L2 e2e
REJECTED
0.6442
İsimden gerçek L2 / worker hattı denemesi; skor eşiğin çok altında → rejected.
…
lora.gguf
PENDING_REVIEW
null
Callback yok / zincir tamamlanmamış.
4. Sonuç raporu (istenen format)
Soru	Cevap
Elimizde gerçek ACTIVE LoRA var mı?
Bu DB örneğinde tek ACTIVE kayıt e2e-smoke; bu, manuel smoke ile üretilmiş (minimal GGUF + sabit skor). Gerçek BitNet/QVAC benchmark + worker kararıyla gelen bir ACTIVE bu tabloda yok.
Varsa hangisi?
Smoke kaydı: adapterId …cmnxhgvz00002kl889yy6fna1, isim e2e-smoke, skor 88.5 (kaynak: script, ürün ölçümü değil).
Yoksa neden yok?
BitNet adlı gerçek deneme aynı DB’de REJECTED (0.6442). Üretimde “gerçek ACTIVE” için worker’ın approved üretmesi ve eşiği geçmesi gerekir; bu ortamda o yol henüz başarılı ürün sonucu üretmemiş.
Score eşiği ne?
Backend’de yok. Worker varsayılanı R3MES_SCORE_THRESHOLD=75.0; approved iff quality >= score_threshold.
Tipik REJECTED skorlar ne?
Tek örnek: 0.6442 (bu ortam); genel aralık backend’de tanımlı değil — reddedilen her kayıt için benchmarkScore webhook’taki skordur (0–100 ölçeğinde aggregate_quality beklenir, düşük değerler rejected).
Başarı kriteri: ACTIVE kararı veri tarafında net: DB’de status + benchmarkScore; eşik ise worker env (score_threshold) ve gönderilen status ile belirlenir — backend tek başına “şu skordan geçti” satırını saklamaz. Ürün seçimi için worker konfigürasyonu + webhook logları (veya gelecekte threshold’un DB’ye yazılması) gerekir; şu an kanıt zinciri eşik = worker varsayılanı 75.

-----------

Aday test akışı nasıl olmalı?
Runtime’ı sabitle — Tek pin: BITNET_QVAC_PRODUCTION_MATRIX.md (base 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf, qvac b7349, TQ2 LoRA).
Aday başına benzersiz trial id — Örn. 2026-04-15_expA.
Upload → QA → terminal — API’den adapterId, weightsCid, benchmarkJobId kaydet; bitince GET /v1/adapters/:id ile benchmarkScore ve status.
verify:lifecycle-chain — Kanıt satırını trial dosyasına yapıştır.
COMPARISON.md’e bir satır ekle — Karşılaştırma tablosu güncellenir.
Ayrıntılı sıra: LORA_CANDIDATE_TRIALS.md §1.

Her denemede hangi veri toplanmalı?
Alan	Rol
base model
Pin adı (tüm adaylarda aynı olmalı)
adapter dosyası
Yerel yol + isteğe bağlı SHA256
weightsCid
IPFS / API kimliği
benchmarkJobId
Webhook jobId ile aynı
benchmarkScore
Sayısal kıyas
final status
ACTIVE / diğer — ürün kıyasında çoğunlukla ACTIVE
adapterId
DB/API anahtarı + verify
Şablon: lora-trials/TRIAL_RECORD.template.md.

Karşılaştırma tablosu nasıl tutulmalı?
Tek canlı tablo: lora-trials/COMPARISON.md — her deneme yeni satır, eski satırlar silinmez.
İsteğe bağlı: Aynı sütunlarla COMPARISON.csv (Excel); kaynak tablo markdown ile hizalı kalmalı.
ACTIVE odaklı okuma: status sütununa göre filtre veya dosyada ayrı “yalnızca ACTIVE” bölümü (manuel).
Log düzeni: infrastructure/lora-trials/runs/<trial-id>/TRIAL_RECORD.md (şablondan kopya); ham llama/worker logları için trial id ile dosya adı eşlemesi önerilir — büyük dosyalar repoya konmaz.

Eklenen dosyalar: infrastructure/LORA_CANDIDATE_TRIALS.md, infrastructure/lora-trials/TRIAL_RECORD.template.md, infrastructure/lora-trials/COMPARISON.md (başlangıç tablosu), infrastructure/README.md içine kısa link.

Başarı kriteri: Yeni LoRA denemeleri aynı BitNet profili üzerinde tek akış + tek karşılaştırma tablosu ile dağılmadan kıyaslanabilir.

--------------

Repo gerçeğine göre özet aşağıda. (Kaynak: hidden_dataset.json — Türkçe tr-gen-*; settings.py — score_threshold=75.0; INTEGRATION_CONTRACT §3.3 — tek LoRA GGUF; faz_5/faz_3.md — general.type=adapter zorunluluğu.)

Tek cümle (“Biz şu tip LoRA arıyoruz…”)
Biz, pin’li resmi taban GGUF (BitNet/QVAC varsayılanı veya aynı matristeki Qwen) ile uyumlu, general.type=adapter olan tek dosya llama.cpp LoRA GGUF üretip, gizli Türkçe benchmark’ta (ROUGE/BLEU birleşik skor) ≥75 eşiğini ve lifecycle QA zincirini geçebilen adapter’ları gerçek ACTIVE adayı sayıyoruz.

Sonuç raporu
Alan	İçerik
Hedef LoRA profili
Format: Üretim kanonuna uygun tek LoRA GGUF (§3.3.1); sunucuda safetensors→GGUF yok. Tip: GGUF metadata’da general.type = adapter (full model / yanlış tip elenir). Taban: Resmi donmuş base GGUF ile eşleşen eğitim (RUNTIME_PROFILES / BITNET_PINNED_ENV_MATRIX ile aynı hat). Kalite: Worker’daki gizli set (hidden_dataset.json) — kısa Türkçe soru–referans çiftleri; skor ≥ R3MES_QA_SCORE_THRESHOLD (varsayılan 75.0). Ürün hizası: Chat LoRA zorunlu (§3.5.1); amaç “rastgele model” değil, benchmark + taban ile hizalı topluluk adaptörü.
Hangi LoRA’lar elenmeli
Safetensors / zip / çoklu parça ile doğrudan runtime yükleme bekleyenler. GGUF ama general.type ≠ adapter (ör. “model” olarak paketlenmiş ağırlıklar). Taban uyumsuz eğitim (farklı mimari / farklı base’e göre eğitilmiş; küçük MoE vb. ile karışık denemeler — faz_3 örneği). Türkçe referansla düşük skor (< eşik) veya sadece İngilizce / alakasız domain’de eğitilmiş “genel HF LoRA” denemeleri. Benchmark dışı rastgele deneme (sistem çalışıyor; sorun runtime değil, ölçülen kalite + uyumluluk).
Bir sonraki arama/üretim yönü
Tek doğrulama ekseni: Seçili base GGUF + Türkçe kısa cevap tarzı veri ile LoRA/DoRA eğitimi → çevrimdışı GGUF export (adapter) → yerelde llama-server + POST /lora-adapters ile duman → sonra IPFS tek CID upload ve QA kuyruğu. Eşik ve metrikler için tek kaynak: worker hidden_dataset.json + score_threshold; ürün politikası için R3MES.md / docs/ai_architecture.md §7.
Başarı kriteri (tek satır)
Takım için pratik özet: Aday = tek dosya LoRA GGUF + doğru taban + adapter tipi + Türkçe gizli benchmark’ta ≥75 + QA zinciri tamam; buna uymayan her şey bilinçli olarak aranmaz / üretilmez.

İstersen bir sonraki adımda bu cümleyi INTEGRATION_CONTRACT.md veya packages/qa-sandbox/README.md içine tek paragraflık “ACTIVE aday tanımı” olarak gömebilirim; şu an sadece metin olarak teslim ettim.
