# R3MES Yük Testi Senaryoları ve Metrik Ağı — Faz 9 (SRE)

Bu belge, binlerce eşzamanlı kullanıcı yükünde bile servis davranışının gözlemlenebilmesi ve kontrol altında tutulması için **K6 yük betiği**, **Prometheus uyarı kuralları** ve operasyonel **kırılma senaryolarını** tanımlar. **Canlı yük vuruşu yalnızca onaylı, izole ortamlarda** yapılmalıdır; bu repoda yalnızca betik ve konfigürasyon (Infrastructure as Code) tutulur.

---

## 1. Amaç ve Kapsam

| Hedef | Açıklama |
|--------|-----------|
| Ramp-up | Sanal kullanıcı (VU) sayısının kontrollü artışı; ani trafik şokundan ziyade **2 dakikada 0 → 5000 VU** profili (`r3mes-load-test.js`). |
| Uç noktalar | **Fastify:** `GET /v1/adapters` (okuma ağırlıklı). **FastAPI:** `POST /v1/chat/completions` (bellek/CPU ağırlıklı inference). |
| Gözlem | HPA ile uyumlu **CPU/bellek sinyalleri** ve **OOM** olayları için Prometheus uyarıları; Grafana Alerting veya Alertmanager ile rota. |
| Kısıt | Üretim veya paylaşımlı ağlara **izinsiz / plansız** tam yük uygulanmaz; betikler repoda **çalıştırılmadan** saklanır. |

---

## 2. K6 Betiği Özeti

**Dosya:** `infrastructure/testing/k6/r3mes-load-test.js`

- **Executor:** `ramping-vus` — `startVUs: 0`, tek aşama: **2 dakika** içinde **5000** hedef VU (`gracefulRampDown: 30s`).
- **Trafik karışımı:** Yaklaşık **%35** `GET /v1/adapters` (Fastify), **%65** `POST /v1/chat/completions` (FastAPI) — inference tarafı bellek baskısını simüle eder.
- **Ortam değişkenleri:**
  - `R3MES_API_BASE` — Fastify kök URL (varsayılan `http://127.0.0.1:3000`).
  - `R3MES_AI_BASE` — FastAPI kök URL (varsayılan `http://127.0.0.1:8000`).
  - `R3MES_AUTH_TOKEN` — isteğe bağlı Bearer.
  - `R3MES_CHAT_MODEL`, `R3MES_CHAT_MAX_TOKENS` — sohbet gövdesi ince ayarı.
- **Eşikler (thresholds):** `http_req_failed < %5`, `p(95) < 8s`, `checks > %90` — staging kalibrasyonunda sıkılaştırılabilir veya gevşetilebilir.

**Not:** Tek makinede 5000 VU çoğu zaman **fiziksel olarak mümkün değildir**; gerçekçi tam yük için K6 **distributed execution** (ör. birden fazla yük üreticisi veya K6 Cloud — kurumsal politikalara uygun) kullanılmalıdır. Bu betik, **senaryo tanımı** ve CI’de “dry” doğrulama (betik sözdizimi) için tasarlanmıştır.

---

## 3. Donanım / Yazılım Kırılma Senaryoları

Aşağıdaki senaryolar, yük testi sırasında veya üretimde gözlenmesi beklenen **kırılma modları** ve önerilen tepilerdir.

### S1 — API Gateway (Fastify) patlaması

- **Belirti:** `GET /v1/adapters` gecikmesi ve hata oranı artışı; Pod CPU sürekli yüksek.
- **Kök neden adayları:** DB bağlantı havuzu tükenmesi, N+1 sorgu, rate limit eksikliği.
- **Gözlem:** HPA CPU uyarıları (`R3MES_HPA_CPU_ApproachingScaleOut`); Pod sayısı artışı.

### S2 — Inference (FastAPI) bellek baskısı ve OOM

- **Belirti:** `POST /v1/chat/completions` için uzun süren istekler, bellek limitine dayanma, **OOMKilled**.
- **Kök neden adayları:** Model/LoRA yükleme, batch boyutu, eşzamanlı uzun bağlam.
- **Gözlem:** `R3MES_Memory_WorkingSet_NearLimit_OOMRisk`, `R3MES_Container_OOMKilled`; node tarafında `R3MES_Node_Memory_Pressure`.

### S3 — HPA gecikmesi (lag)

- **Belirti:** Metrikler eşiği aştıktan sonra replika artışı gecikiyor; kısa süreli kuyruk birikmesi.
- **Tepki:** `behavior.scaleDown` / `scaleUp` pencereleri, metrik penceresi (`--average-utilization`) ve KEDA/external metrik gözden geçirmesi (manifestler bu repoda tanımlı değildir).

### S4 — Ağ doygunluğu

- **Belirti:** Yük üreticisi veya ingress tarafında paket kaybı, TLS el sıkışma gecikmesi.
- **Tepki:** Yük üreticilerini coğrafi dağıtma, ingress connection limit ve backend keep-alive ayarı.

### S5 — “Pod patlaması” (OOM domino etkisi)

- **Belirti:** Bir düğümde bellek baskısı → birden fazla Pod eviction / OOM.
- **Tepki:** Pod anti-affinity, kaynak quota, farklı node pool’lara inference ayırma.

---

## 4. Prometheus / Grafana Uyumlu Metrik ve Alarmlar

**Dosya:** `infrastructure/testing/prometheus/alerts/r3mes-k8s-hpa-oom.rules.yml`

| Kural | Amaç |
|--------|------|
| `R3MES_HPA_CPU_ApproachingScaleOut` | CPU kullanımının request’e oranı **> 0.75** (3 dk) — HPA ölçek **çıkışı** ile uyumlu erken uyarı. |
| `R3MES_HPA_Memory_ApproachingScaleOut` | Working set / memory limit **> 0.80** (5 dk) — bellek tabanlı ölçek veya limit ince ayarı. |
| `R3MES_Container_OOMKilled` | `OOMKilled` sonlandırma sayısı artışı — kritik. |
| `R3MES_Memory_WorkingSet_NearLimit_OOMRisk` | working_set/limit **> 0.92** (2 dk) — OOM öncesi kritik bant. |
| `R3MES_Node_Memory_Pressure` | Düğümde kullanılabilir RAM oranı düşük — eviction riski. |

**Entegrasyon:** Prometheus Operator `PrometheusRule` CRD ile uygulanabilir veya dosya tabanlı `rule_files` ile yüklenir. **Grafana Unified Alerting**, Prometheus uyarılarını veri kaynağı olarak içe aktarabilir; Mimir kullanılıyorsa aynı PromQL ifadeleri geçerlidir.

**Uyarı:** `kube_pod_container_resource_requests` ve `container_*` metrik adları, küme versiyonuna göre değişebilir; kurulumdan sonra **grafik ve örnek sorgularla doğrulanmalıdır**.

---

## 5. Güvenlik ve Operasyon Kuralları

1. Yük testi **yalnızca** staging / dedicated load ortamında; üretim URL’leri için **yazılı onay** olmadan çalıştırılmaz.
2. Kimlik bilgileri (`R3MES_AUTH_TOKEN`) repoya **asla** commit edilmez; CI’de secret store kullanılır.
3. 5000 VU hedefi **mantıksal senaryodur**; altyapı kapasitesi ve yasal/operasyonel limitler (ör. sağlayıcı kotası) kontrol edilir.
4. Bu belge, felaket senaryosu tatbikatlarında **runbook** eki olarak güncellenmelidir.

---

## 6. Sonraki Sözleşmeler (Bu Repoda Olmayanlar)

- Gerçek HPA `HorizontalPodAutoscaler` manifestleri (CPU/memory veya özel metrik).
- K6 sonuçlarının InfluxDB / Prometheus’a push edilmesi (`k6-statsd` veya native remote write).
- Grafana dashboard JSON panelleri (bu fazda yalnızca alarm kuralları verildi).

---

*Belge: Faz 9 — Altyapı / SRE. Yük betiği ve uyarılar kod olarak repoda; canlı koşum kullanıcı ortamına bırakılmıştır.*
