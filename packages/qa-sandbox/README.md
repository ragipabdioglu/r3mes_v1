# `@r3mes/qa-sandbox`

## Sahiplik

- **Sorumlu ajanlar:** AI (benchmark worker), Güvenlik (izolasyon politikaları ürün genelinde).
- **Faz 6:** Otonom QA — `worker/` altında Python Redis tüketicisi.

## İçerik

| Bileşen | Açıklama |
|---------|----------|
| `src/` (TypeScript) | Paylaşılan tipler / köprü — mevcut workspace paketi |
| `worker/` | **Python** `r3mes-qa-worker`: Redis (`r3mes-benchmark`), IPFS indirme, gizli veri seti, ROUGE-L/BLEU, webhook |

## QA worker (Faz 6)

```bash
cd packages/qa-sandbox/worker
pip install -e ".[dev]"
python -m r3mes_qa_worker
```

Ayrıntılar: `worker/README.md`.

## Backend beklentisi

Fastify tarafında `POST /v1/internal/qa-result` mock ucu; gövde alanları: `jobId`, `adapterCid`, `status` (`approved` \| `rejected`), `score`, `threshold`, `metrics`, `error`.
