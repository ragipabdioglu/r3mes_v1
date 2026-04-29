# `infrastructure/docker`

## Sahiplik

- **Sorumlu ajan:** Altyapı (konteyner imajları, güvenli varsayılanlar, CI/CD entegrasyonu).

## Amaç

Mikroservis imajları için **ortak taban** (`Dockerfile.base`): minimize edilmiş Alpine tabanı, `tini` ile PID 1, **non-root** kullanıcı (`app`, UID/GID `65532`). Uygulama Dockerfile’ları bu tabanı `FROM` eder ve yalnızca gerekli artefact’ları kopyalar.

## Dosyalar

| Dosya | Açıklama |
|--------|-----------|
| `Dockerfile.base` | Node 20 Alpine; `USER app`; `ENTRYPOINT` tini. Canlı dağıtım veya `docker build` buradan yapılmaz — yalnızca şablon. |
| `docker-compose.postgres.yml` | Yerel **PostgreSQL 16** (`:5432`, kullanıcı/parola `postgres` / `postgres`, DB `r3mes`). Prisma migrate ile birlikte kullanılır. |
| `docker-compose.storage.yml` | **Faz 2 — yalnızca depolama üçgeni:** Kubo (IPFS), Redis, OpenResty geçidi (Nginx + Lua). API/FE içermez. |
| `nginx/nginx.conf` | Geçit: Kubo’ya `proxy_pass`, `proxy_cache` (disk), `slice`, Lua ile Redis sayaç; `/health` uçu. |

## Yerel depolama yığını (Faz 2)

Kökten:

```bash
docker compose -f infrastructure/docker/docker-compose.storage.yml up -d
curl -fsS http://localhost:9080/health
```

- **9080:** geçit (Nginx/OpenResty); konteyner içi 8080, host’ta **9080** (C++ llama-server 8080 ile çakışmayı önler). **`GET /health`** → `healthy`.
- **5001:** Kubo API (dev).
- **4001:** P2P (TCP/UDP).
- **6379:** Redis (sıcak meta / sayaç; AI worker ile paylaşılabilir).

**Not:** HTTP gövde önbelleği `proxy_cache` ile diskte (`nginx_cache` volume). Redis, Lua üzerinden istatistik ve ileride CID meta anahtarları için kullanılır; çok büyük blob’ların tamamını Redis’te tutmak önerilmez.

## Not

Üretimde imaj tarama (Trivy, GHCR) ve imaj imzalama bu repoda Faz 2+ ile eklenebilir.
