# `infrastructure/testing`

## İçerik

| Yol | Açıklama |
|-----|----------|
| `k6/r3mes-load-test.js` | K6 ramp-up yük betiği (Fastify + FastAPI uçları). |
| `k6/env.example` | Örnek ortam değişkenleri (sırları repoya koymayın). |
| `prometheus/alerts/r3mes-k8s-hpa-oom.rules.yml` | HPA sinyali + OOM riski Prometheus uyarıları (Grafana uyumlu). |
| `load_test_scenarios.md` | Senaryolar, metrik ağı ve güvenlik sınırları. |

**Canlı yük testi bu repodan otomatik çalıştırılmaz;** yalnızca kod ve konfigürasyon saklanır.
