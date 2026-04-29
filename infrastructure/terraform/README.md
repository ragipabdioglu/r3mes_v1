# `infrastructure/terraform`

## Sahiplik

- **Sorumlu ajan:** Altyapı (bulut kaynakları, durum yönetimi, ortam ayrımı).

## Amaç

Gerekirse VPC, yönetilen PostgreSQL/Redis, DNS ve IAM için Terraform modülleri. **Faz 1 kapsamında `.tf` dosyası yoktur** — yalnızca dizin ve README; gerçek kaynak tanımları ayrı sprintte eklenir.

## Kısıt

Canlı `terraform apply` veya üretim hesabına bağlantı bu repodan otomatik tetiklenmez.
