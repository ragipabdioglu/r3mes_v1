İşlem tamam. Özet rapor aşağıda.

Hangi satırlar değişti
infrastructure/RUNTIME_PROFILES.md
11–13: Eski «burn-in kısmi / kalan iki madde» metni kaldırıldı; yerine repo burn-in’in kapandığı, staging/prod’un release icrası olduğu ve Tek resmi durum cümlesi eklendi.
41: «Operasyon üç kapı (kısmi…)» → Operasyon burn-in (üç kapı) — kapandı + staging/prod = release icrası (ek gate değil).
60: Karar cümlesine üç kapı burn-in kapandı ve tek kanıt satırı eklendi.
89: «Rollout tamamlandı mı?» → Evet (R1–R4 + L2 + üç kapı) + staging/prod = release icrası.
158: Sonuç özeti eski «kısmi / kalan» dilinden kapandı + release icrası diline çekildi.
11 (düzeltme): «iz» yazımı «bkz.» olarak düzeltildi.
infrastructure/BITNET_FLIP_FINAL_GATES.md
4: RUNTIME_PROFILES ile aynı dil + staging/prod = release icrası (ek gate değil) cümlesi eklendi.
104: Alt başarı cümlesi «Kalan… gate» yerine «Sonraki adım (gate değil): release icrası» olarak netleştirildi; RUNTIME_PROFILES ile çerçeve eşlemesi vurgulandı.
Yeni resmi durum cümlesi
BitNet/QVAC repo içi teknik ve operasyon burn-in seviyesinde kapanmıştır; staging ve prod aynı prosedürün release icrasıdır.

(Aynı cümle RUNTIME_PROFILES.md satır 13’te duruyor; Qwen rolü hemen altında referansla sabitlendi.)

Hangi belge tek kaynak sayılmalı?
Resmi politika, yürürlük, R1–R4, L2 özeti, Qwen rolü, tek cümle: RUNTIME_PROFILES.md — birincil tek kaynak («runtime ne resmi?» sorusunun cevabı).
Üç kapı burn-in kanıtı, komutlar, checksum/verify satırları: BITNET_FLIP_FINAL_GATES.md — operasyonel kanıt eki; RUNTIME_PROFILES ile artık aynı gerçeği, aynı dilde (kapanış + staging/prod = release) anlatıyor.
Staging/prod icrası: RELEASE_CHECKLIST.md — release süreci (gate değil).
Başarı kriteri
İki ana belge aynı çerçeveyi kullanıyor: BitNet/QVAC için repo teknik + burn-in kapanmış; staging/prod ek gate değil, aynı prosedürün release icrası.

------------

Sonuç raporu (istenen format)
Soru	Cevap
Backend metninde düzeltme gerekir mi?
Gerekli netleştirmeler yapıldı. RELEASE_RUNTIME_FLIP_BITNET_DEFAULT.md içine §0 Terminoloji eklendi; “hazır”, “gate”, “deploy” ayrımı tabloyla yazıldı. §3 başlığı “üretim hedefi” olarak netleştirildi; §4 tablo satırı “prod deploy ayrı adım” diye düzeltildi; §5 başlığı “deploy sonrası / hedef ortam” olacak şekilde güncellendi; §7 notu “prod deploy bu tablo değildir” diyerek sınırlandı. README.md flip cümlesi release hazır ≠ prod deploy ile bağlandı.
Hazır vs deploy ayrımı net mi?
Evet. infrastructure/BITNET_DEFAULT_FLIP.md girişi yeniden yazıldı: “Rollout gate’leri kapandı” artık tek başına “prod’da BitNet çalışıyor” okunmasın diye açıkça üretim dağıtımının ayrı olduğu belirtiliyor; gate / deploy / resmi varsayılan kararı üçlü tabloyla ayrıldı. BITNET_FLIP_FINAL_GATES.md amaç cümlesi “flip yapabiliriz” → ön koşullar + gate ≠ prod deploy olacak şekilde yumuşatıldı ve BITNET_DEFAULT_FLIP’e cross-link verildi.
Başarı kriteri
Backend dokümanlarında “hazır = artifact + contract güveni”, “gate kapandı = checklist”, “deploy = hedef ortamda icra” ayrımı artık yanlış alarm üretmeyecek şekilde yazılı; release dili ile prod yürütme karışmıyor.

-------------

ORTAK son cümle
Bu oturumda ve repoda ORTAK’ın kesin son cümlesi yok; bu yüzden metnin harfiyen resmi kararla örtüştüğünü doğrulayamıyorum. Karar metni elinize geçince tek kontrol: BITNET_DEFAULT_RUNTIME_PUBLIC_LINE ile NEXT_PUBLIC_INFERENCE_RUNTIME_CONTEXT aynı mı?

Şu anki tek kaynak satır (lib/ui/product-copy.ts):

Varsayılan çıkarım hattı BitNet (QVAC); Qwen yedek veya referans için kullanılır.

Sonuç raporu
Mevcut hint yeterli mi?
Yapı olarak evet — tek satır, minimal, BitNet varsayılan + Qwen rolü net; çelişkili ikinci bir kullanıcı metni yok. Resmi metin ORTAK’tan farklıysa yeterlilik “içerik” açısından yeniden değerlendirilir.
Tek satır güncelleme gerekir mi?
ORTAK cümlesi yukarıdakinden farklıysa evet — yalnızca BITNET_DEFAULT_RUNTIME_PUBLIC_LINE ve dağıtım env’i (ve .env.example yorum satırı) hizalanır; yeni UI gerekmez. ORTAK birebir aynıysa hayır.
Özet: Eski/çelişkili ifade kalmaması için tek adım, ORTAK metnini bu sabitle karşılaştırmak; fark varsa tek satırlık wording güncellemesi.

