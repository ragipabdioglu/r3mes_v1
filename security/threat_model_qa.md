# R3MES QA Sandbox — Tehdit Modeli ve Güvenlik Sınırları

Bu belge, yüklenen model ağırlıkları (LoRA ve benzeri) ve arşivler üzerinden **RCE (Remote Code Execution)** ve **veri sızıntısı (exfiltration)** risklerini tanımlar; `packages/qa-sandbox/` altındaki sertleştirilmiş konteyner kabuğunun bu riskleri nasıl düşürdüğünü açıklar.

**Kapsam dışı:** Akıllı kontrat (Move) güvenliği, ROUGE/ML değerlendirme algoritması — yalnızca otonom sandbox sınırları.

---

## 1. Varlıklar ve güven sınırları

| Varlık | Açıklama |
|--------|----------|
| Gizli test veri seti | Değerlendirme sırasında referans olarak kullanılan, dışarı sızmaması gereken veri |
| Yüklenen LoRA / ağırlık | Kullanıcı veya dış sistem tarafından sağlanan dosyalar |
| Değerlendirme süreci | Konteyner içinde çalışan eval komutu (AI ajanı tarafından sağlanır) |
| Host ve orkestrasyon | Docker daemon, CI, depolama — ayrı tehdit yüzeyi |

**Güven varsayımı:** Üretim hattında yalnızca bu belgedeki katı girdi kuralları ve `Dockerfile.sandbox` + `docker run` parametreleri birlikte uygulanır.

---

## 2. Saldırı senaryoları: model ve arşiv ile RCE

### 2.1 Pickle ve türevleri (PyTorch `.pt` / `.pth`, bazı `.pkl`)

Python `pickle` (ve PyTorch’un pickle tabanlı yükleme yolları) **serileştirilmiş nesne grafiğini** geri yükler; kötü niyetli nesneler `__reduce__` vb. ile **import ve kod çalıştırma** tetikleyebilir. Bu, “dosya = veri” beklentisini ihlal eder: dosya, yürütülebilir mantık taşıyabilir.

**Sonuç:** Konteyner içinde keyfi kod; okunan gizli veri seti ile birleşince **exfiltration** (ağ veya paylaşılan birime yazma).

### 2.2 TensorFlow SavedModel / Checkpoint ve özel op’lar

`.pb`, SavedModel dizinleri veya güvensiz yükleme yolları, **graf içi veya çevresel** kod yürütme veya beklenmeyen sistem etkileşimine yol açabilir (sürüme ve yükleme API’sine bağlı). Zip içi beklenmeyen dosyalar ek yüzey açar.

### 2.3 `safetensors` dışındaki “bypass” dosyaları

- **Çift uzantı / yanlış etiket:** `evil.safetensors.exe` veya MIME ile uyumsuz içerik.
- **Polyglot dosyalar:** Bir formatta geçerli görünüp başka bir yükleyiciyi tetikleyen içerik.
- **ZIP / arşiv:** Zip slip, aşırı sıkıştırma, beklenmeyen çıkarılan yollar; içeride pickle veya yürütülebilir içerik.

### 2.4 Kaynak tüketimi ve yan kanallar

Kötü niyetli tensör veya büyük başlık JSON’u **bellek / CPU** üzerinden DoS üretebilir; bu doğrudan RCE değildir ancak değerlendirme ortamını çökertir.

---

## 3. Katı dosya tipi ve `safetensors` başlık doğrulaması

Aşağıdaki katmanlar **birlikte** kullanılmalıdır; tek başına MIME veya uzantı yeterli değildir.

### 3.1 Uzantı allowlist ve denylist

- **İzin verilen:** `.safetensors`, `.json`, `.txt` (yalnızca manifest / küçük metin; büyük txt reddedilir).
- **Açıkça reddedilen:** `.pkl`, `.pickle`, `.pt`, `.pth`, `.ckpt`, `.h5`, `.pb`, `.zip`, `.tar`, `.gz`, `.7z`, `.bin` vb.

Uygulama: `packages/qa-sandbox/scripts/validate-input-artifacts.sh`

### 3.2 MIME (`file --mime-type`) — yardımcı katman

- `safetensors` genelde `application/octet-stream` görünür; bu yüzden MIME **ayırt edici değildir**, fakat **beklenmeyen** `text/html`, `application/x-executable` vb. ile çelişki yakalanır.
- `json` için `application/json`, `txt` için `text/plain` beklenir; sapma **red**.

### 3.3 `safetensors` yapısal (başlık) onayı

Format: ilk **8 bayt** little-endian `uint64` = `N` (başlık uzunluğu); ardından `N` bayt **UTF-8 JSON** başlık; sonra tensör verisi.

Doğrulama adımları:

1. `N > 0` ve makul üst sınır (ör. 256 MiB altı) — aşırı büyük başlık DoS / bellek riski.
2. JSON’un `json.loads` ile parse edilmesi; üst seviye **dict** ve boş olmaması (en az bir tensör / metadata anahtarı).
3. İçeriğin **pickle veya rastgele ikili** olarak yanlış etiketlenmiş olması, yapısal parse ile büyük ölçüde elenir; yine de eval kodunun `torch.load` pickle yolunu **asla** kullanmaması gerekir (AI ajanı sorumuluğu).

---

## 4. `qa-sandbox` kafesinin risk azaltımı

### 4.1 Ağ izolasyonu: `--network none`

- Konteynerin **hiçbir** dış IP’ye route’u olmaz; HTTP/DNS ile veri sızdırma **bu katmanda** engellenir.
- Giriş noktası: `scripts/docker-run-eval.example.sh` ve Dockerfile yorumları.

**Kalan risk:** Host ile paylaşılan volume üzerinden sızıntı (ör. yanlışlıkla yazılabilir mount). Çözüm: girdi dizinini **yalnızca `:ro`** mount edin.

### 4.2 Salt okunur kök: `--read-only` ve `--tmpfs /tmp`

- Kök dosya sistemi yazılamaz; kalıcı payload bırakma ve birçok kaçış yolu zorlaşır.
- Geçici dosya için sınırlı `tmpfs` (ör. `noexec,nosuid,size=...`) önerilir.
- `sandbox-entry.sh`, başlamadan önce `/` altına yazılamadığını ve `--network none` ile uyumlu rotayı doğrular.

### 4.3 Ayrıcalık düşürme

Örnek çalıştırma: `--security-opt no-new-privileges:true`, `--cap-drop ALL`, non-root kullanıcı (`USER sandbox`).

### 4.4 Girdi doğrulama ile birleşik etki

| Tehdit | Ağ yok | RO FS | Girdi allowlist + safetensors başlığı |
|--------|--------|-------|----------------------------------------|
| Dışarı exfiltration (ağ) | Güçlü azaltım | — | — |
| Pickle RCE dosyası | — | Azaltım (kalıcılık zor) | **Uzantı reddi** |
| Zip / çoklu format bypass | — | — | **Zip reddi** |
| Kötü niyetli safetensors (yapısal) | — | — | **Başlık şeması + boyut sınırı** |

**Önemli:** Sandbox, **eval kodunun** pickle kullanmaması, güvensiz `eval`/`exec` içermemesi ve yalnızca onaylanmış kütüphanelerle `safetensors` okuması ile tamamlanır; aksi halde RCE riski kod yolunda kalır.

---

## 5. Güvenlik özeti (yöneticiler için)

- Yüklenen model dosyaları **veri değil, potansiyel kod** taşıyabilir (pickle, kötü niyetli yükleme zinciri).
- `Dockerfile.sandbox` ve `docker run` şablonu, **ağsız** ve **salt okunur kök** ile sızdırma yüzeyini daraltır; **dosya allowlist + safetensors başlık doğrulaması** ile pickle/zip tabanlı yüzeyler kapatılır.
- Kalan riskler: host yanlış yapılandırması, eval kodunda pickle/exec, kernel/daemon düzeyi ayrı konular.

---

## 6. İlgili dosyalar

| Dosya | Amaç |
|-------|------|
| `packages/qa-sandbox/Dockerfile.sandbox` | Sertleştirilmiş imaj |
| `packages/qa-sandbox/scripts/sandbox-entry.sh` | Eval öncesi izolasyon kontrolleri |
| `packages/qa-sandbox/scripts/validate-input-artifacts.sh` | Uzantı, MIME, safetensors başlık kontrolü |
| `packages/qa-sandbox/scripts/docker-run-eval.example.sh` | `--network none`, `--read-only`, `tmpfs` örneği |

---

*Belge: Faz 6 — Siber Güvenlik / Tehdit Modelleme. Güncelleme gerektiğinde mimari değişikliklerle birlikte gözden geçirin.*
