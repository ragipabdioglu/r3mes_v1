# `infrastructure/k8s`

## Sahiplik

- **Sorumlu ajan:** Altyapı (Kubernetes manifestleri, Helm chart’lar, NetworkPolicy taslağı).

## Amaç

`docs/infrastructure_architecture.md` ile uyumlu küme topolojisi: Ingress, `backend-api`, `ai-engine`, IPFS gateway, PostgreSQL/Redis harici veya operatör. Bu klasör **Faz 1’de boş şablon** olarak ayrılmıştır; `kubectl apply` veya canlı küme hedefi **yapılmaz**.

## Sonraki adımlar (özet)

- Namespace ve ServiceAccount
- Deployment + HPA iskeleti
- Secret/ConfigMap konvansiyonu (GitOps ile birlikte)
