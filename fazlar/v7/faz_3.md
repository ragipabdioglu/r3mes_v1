Veri (Postgres — en yeni kayıt)
Alan	Değer
adapterId
cmnzzd8kk0002kl5oshdke2id
name
tr-v1_demo
createdAt
2026-04-15T11:42:04.196Z
status
PENDING_REVIEW
domainTags
[]
weightsCid
QmbwrjB5Vfdm1NofmBZhTPdwi4BHcSgG4A98SNEiwpLFMm
updatedAt
upload ile aynı (sonradan QA güncellemesi yok)
Bypass açık olsaydı kod domainTags: ["r3mes:dev-test"] ve status: ACTIVE yazardı. Boş domainTags + PENDING_REVIEW → bu istek normal upload dalını kullanmış; isDevQaBypassEnabled() o süreçte false kalmış.

Logda ne aranmalı?
Bypass yok: e2eLifecycle: "upload_accepted" (ve devBypassQa: false veya yok).
Bypass var: e2eLifecycle: "upload_accepted_dev_bypass_qa" (devBypassQa: true).
Bu kayıt için beklenen: upload_accepted (sadece veriye göre).

Env mantığı (kod)
R3MES_DEV_BYPASS_QA=1 ve NODE_ENV development veya test olmalı; aksi halde bypass kapalı (staging / üretim / yanlış NODE_ENV → PENDING_REVIEW).

Tek cümle: neden hâlâ İncelemede?
Upload’u, dev bypass’ın açık olmadığı Node süreci işledi (domainTags boş → normal yol); bu yüzden PENDING_REVIEW kaldı.

Bir sonraki upload öncesi tek düzeltme
R3MES_DEV_BYPASS_QA=1 ve NODE_ENV=development (veya test) aynı ortamda backend’i başlatın (.env yükleniyor mu: node --env-file=.env veya IDE’nin doğru env’i verdiğinden emin olun).
Eski süreç hâlâ ayakta ise durdurup yeniden başlatın — env değişince process yeniden gerekir.
İsteğe bağlı doğrulama: sunucu açılışında console.log veya geçici log ile process.env.R3MES_DEV_BYPASS_QA / NODE_ENV yazdırın.
Başarı kriteri: Yeni upload sonrası DB’de status=ACTIVE ve domainTags içinde r3mes:dev-test görünce bypass devreye girmiştir.

-----------

Bu ortamda canlı veritabanına erişim yok; adapterId / weightsCid / isim / skor için tek kaynak çalışan API (GET /v1/adapters veya seçtiğiniz karttaki ipfsCid) olur. Aşağıdaki sınıflandırma, verdiğiniz metin örüntüsü ve repodaki bilinen BitNet/biyomed hattı ile yapıldı.

1) Hangi adapter kullanıldı? (kimlik)
Kod tabanından kesin bir satır seçilemez — marketplace kaydı sizin deploy ettiğiniz Postgres’te. Kesin kimlik için:

Pazarda tıkladığınız kartta ipfsCid (ve mümkünse adapterId) not edin; veya
GET /v1/adapters?status=ACTIVE ile name, weightsCid, benchmarkScore, id alın.
Semptomların kaynağı büyük olasılıkla: Üretim matrisinde referanslanan PubMedQA / biyomed tarzı LoRA ailesi — örnek pin: tq2_0-biomed-trained-adapter.gguf (qvac/fabric-llm-bitnet-finetune, BITNET_QVAC_PRODUCTION_MATRIX.md). Bu dosya, dar “tıbbi evet/hayır/belirsiz + gerekçe” formatına eğitilmiş bir hatırlatıcıdır.

2) Neden sabit / bozuk cevap? (sınıflandırma)
Etken	Bu vakada rol
Dar domain adapter (asıl sebep)
Evet. Eğitim verisi PubMedQA tarzı (Yes / No / Uncertain + Rationale:). Açık sohbette bile model bu şablonu tekrarlamaya çok güçlü şekilde meyledebilir.
Prompt / şablon uyumsuzluğu
Kısmen. Sohbet ChatML ile gidiyor; LoRA ise farklı bir görev biçimine (tıbbi SFT) kilitlenmiş. Görev uyuşmazlığı “her mesajda aynı tür cevap” üretir.
C. elegans sabitlenmesi
Eğitim verisinde sık geçen bir örnek / kalıp (model organizması). Rastgele genel sohbet sorusunda bile “gerekçe” cümlesine ezberlenmiş bir domain örneği düşebilir; bu, adapter’ın genel chat için uygun olmadığının tipik belirtisi.
Stop token eksikliği
Katkıda bulunabilir. dApp streamChatCompletions gövdesinde stop göndermiyor (chat-stream.ts); AI engine isteği llama’ya olduğu gibi iletilir (proxy_service.py). Özel sohbet sınırlayıcıları (im_end vb.) istemci tarafında kesilmezse, model şablon devamını metin olarak üretebilir.
Adapter / base uyumsuzluğu
Matris gereği TQ2 BitNet tabanı + TQ2 LoRA ise “tam uyumsuzluk” beklenmez; burada asıl problem mimari değil görev uyumu (biyomed SFT ↔ genel chat).
<|…im_end|>…assistant sızıntısı:
llama-server’ın Chat şablonu özel tokenlarla konuşmayı bitirir; model bazen bu dizgileri normal metin olarak devam ettirir (özellikle LoRA güçlü biçimlendirme öğrendiyse ve stop ile erken kesim yoksa). Bu, upstream’in “chat şablonu bozuk” demekten çok, çıktı üretimi + durdurma katmanı ile uyumlu yorumlanır — yine de kök neden adapter’ın dar görevi + zayıf genelleme.

3) Chat hattı mı bozuk, adapter mı?
Zincir çalışıyor: HTTP 200, cevap akıyor, anlamlı bir şablon (Uncertain + Rationale) geliyor → proxy → AI engine → llama + LoRA hattı ölü değil.
Sorun: Açık uçlu sohbet için yanlış adapter (biyomed QA LoRA) + isteğe bağlı stop/durdurma eksikliği.
Özet: “Chat pipeline bozuk” değil; “Chat çalışıyor ama bu adapter genel sohbet için kötü / yanlış görev” daha doğru.

4) İstenen formatta rapor
Soru	Cevap
Hangi adapter kullanıldı
Kesin ID bu ortamda yok; marketplace’teki ipfsCid / adapterId ile DB’den doğrulayın. Semptomlar biyomed eğitimli LoRA ile uyumlu (matris örneği: tq2_0-biomed-trained-adapter.gguf).
Bozuk cevabın ana sebebi
Dar domain + görev uyumsuzluğu (PubMedQA formatına aşırı uyum); C. elegans ezber/kalıp; stop eksikliği sızıntıyı şiddetlendirebilir.
Chat zinciri çalışıyor mu
Evet (teknik olarak uçtan uca cevap üretiliyor).
Bu adapter chat testi için uygun mu
Genel sohbet için hayır; biyomed QA benchmark için anlamlı olabilir.
Sonraki en doğru test adapter stratejisi
Genel amaçlı sohbet: Türkçe genel instruction LoRA (ör. tr-v1 export) veya açıkça chat için eğitilmiş adapter; aynı BitNet TQ2 tabanı; mümkünse istekte stop ile şablon sınırlayıcıları; karşılaştırmada base-only (LoRA kapalı) bir kısa kontrol.
Başarı kriteri: Takım, “pipeline bozuk” değil “pipeline ayakta; liste ACTIVE olsa bile bu adapter görev dışı (biyomed SFT) kullanıldığı için chat davranışı çökmüş gibi görünüyor” diyebilir. Kesin sayısal kimlik için tek adım: seçilen kartın adapterId + weightsCid + benchmarkScore’unu API’den sabitlemek.