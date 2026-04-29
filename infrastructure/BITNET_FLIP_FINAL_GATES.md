# Varsayılan flip — son üç kapı (operasyon checklist’i)

> **Legacy / R&D notu:** Bu kapılar BitNet/QVAC rollout geçmişi içindir. Aktif MVP runtime kapısı değildir.

**Amaç:** Ön koşullar sağlandığında **kontrollü geçişe** izin verecek **üç kapıyı** somut kutulara çevirmek. **Gate kapanışı ≠ üretimde deploy tamamlandı** — sonuncusu ingress, secret ve rollout kaydı ile ayrı doğrulanır (`[BITNET_DEFAULT_FLIP.md](BITNET_DEFAULT_FLIP.md)` üst paragraf).  
**Bağlam:** `[BITNET_DEFAULT_FLIP.md](BITNET_DEFAULT_FLIP.md)`, `[RUNTIME_PROFILES.md](RUNTIME_PROFILES.md)`. **Dil:** Bu dosya ile `RUNTIME_PROFILES` **aynı hedefi** anlatır; **staging/prod** bu prosedürün **release icrasıdır** (ek gate değil — `[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)`).

**Burn-in (2026-04-14, aynı host):** `pnpm bootstrap` (Postgres + Redis + IPFS + gateway **9080**) + BitNet `docker compose … up` (**8080**) + `node --env-file=.env dist/index.js` (**3000**). Kanıt: `GET http://127.0.0.1:9080/health` → `healthy`; `GET …:3000/ready` → `{"status":"ready"}`; `GET …:8080/v1/models` → **200**. **Checksum:** `[BITNET_CHECKSUM_ARCHIVE.md](BITNET_CHECKSUM_ARCHIVE.md)` + `[docker/SHA256SUMS.bitnet-pin.txt](docker/SHA256SUMS.bitnet-pin.txt)`. **Verify (aynı makine, canlı DB):** `verify=lifecycle-chain` **PASS** — `OFFICIAL_VERIFY_LINE: verify=PASS adapterId=cmnxhgvz00002kl889yy6fna1 jobId=benchmark-0-QmZwiXTNbYBWVccnRyKmveaB … chain=Evet` (`R3MES_VERIFY_BASE_URL=http://127.0.0.1:3000`). Ürün L2 kanon kanıtı: `[GGUF_LIFECYCLE_PROOF_FAZ6.md](../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)`.

---

## Kapı 1 — Pin’li runtime matrisi

**Tek kaynak (dolu matris):** `[BITNET_PINNED_ENV_MATRIX.md](BITNET_PINNED_ENV_MATRIX.md)` + teknik satır `[BITNET_QVAC_PRODUCTION_MATRIX.md](BITNET_QVAC_PRODUCTION_MATRIX.md)`.


| Alan                             | Pin’lenmiş değer                                                              | Kanıt (nereye yazıldı)                                     |
| -------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| qvac / llama-server **build id** | `**b7349`** + `llama-b7349-bin-<os>-<arch>.zip`                               | `BITNET_QVAC_PRODUCTION_MATRIX` §1                         |
| **İkili artifact**               | GitHub release URL + SHA256                                                   | `[BITNET_CHECKSUM_ARCHIVE.md](BITNET_CHECKSUM_ARCHIVE.md)` |
| **BitNet base GGUF**             | `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` + boyut ~912 MB                          | HF + yerel `sha256sum`                                     |
| **Slot 0 placeholder**           | `slot0.gguf` veya eşdeğer; worker ile aynı path                               | `BITNET_PINNED_ENV_MATRIX` §2                              |
| **llama port**                   | **8080** (canonical flip sonrası)                                             | env matrisi §2                                             |
| **Worker**                       | `R3MES_QA_LLAMA_BASE_URL`, `R3MES_QA_MODEL_NAME`, `R3MES_QA_LORA_COPY_TARGET` | deploy secret store                                        |
| **ai-engine**                    | `R3MES_SKIP_LLAMA`, `R3MES_FROZEN_`*                                          | aynı                                                       |


**Checklist**

- Tek runtime matrisi dokümanı: `[BITNET_PINNED_ENV_MATRIX.md](BITNET_PINNED_ENV_MATRIX.md)` (staging/production sütunları + Qwen ayrı satır).
- İkili + GGUF için yeniden indirme: `[BITNET_QVAC_PRODUCTION_MATRIX.md](BITNET_QVAC_PRODUCTION_MATRIX.md)` doğrudan linkler + Docker aşağıda.
- Hedef ortamda (Docker) bu pin’lerle `GET /v1/models` **200** — **2026-04-14** — kanıt: `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §5.
- `**verify:lifecycle-chain` PASS** — aynı host’ta backend + Postgres + (`adapterId` / `jobId` yukarıdaki satır). **L2 ürün kanıtı** ayrıca `[GGUF_LIFECYCLE_PROOF_FAZ6.md](../docs/operations/GGUF_LIFECYCLE_PROOF_FAZ6.md)`.
- **Qwen** referans pin’leri matriste **ayrı**; BitNet ile aynı dosya yolu yok (`[BITNET_PINNED_ENV_MATRIX.md](BITNET_PINNED_ENV_MATRIX.md)` §2).

---

## Kapı 2 — Linux / Docker tekrar üretilebilirlik

Hedef: **temiz bir Linux host veya Docker** üzerinde aynı matrisle **aynı sonuç** (en azından `llama` + health + isteğe bağlı minimal worker dumanı).

**Repodaki tanım:** `infrastructure/docker/Dockerfile.bitnet-qvac` (build arg `QVAC_RELEASE=b7349`) + `[docker-compose.bitnet-qvac.yml](docker/docker-compose.bitnet-qvac.yml)`.

**Tek komut (Linux/macOS, `infrastructure/docker` dizininde):**

```bash
# GGUF’ları models/bitnet/ altına koyun: 1bitLLM-bitnet_b1_58-xl-tq2_0.gguf, slot0.gguf
docker compose -f docker-compose.bitnet-qvac.yml build
docker compose -f docker-compose.bitnet-qvac.yml up -d
curl -sS http://127.0.0.1:8080/v1/models
```

**Checklist**

- **Dockerfile** + **Compose** repoda; imaj etiketi `r3mes/bitnet-qvac:b7349`.
- `docker compose … config` + `build` — repoda doğrulandı (zip içi `llama-server` yolu `find` ile çözülür).
- `docker compose … up` + `GET …/v1/models` **200** — pin’li GGUF’lar `models/bitnet/` altında — **2026-04-14** (`[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §5).
- Volume: bind `models/bitnet` → `/models` (ASCII); host yolu `BITNET_MODEL_HOST_DIR` ile değiştirilebilir.
- **Postgres + Redis + gateway** aynı host — **2026-04-14** (`bootstrap` + `/ready` **200** + gateway `/health`).
- **Yeniden kurulum süresi (kabaca):** imaj build ~5–15 dk (ağa bağlı) + GGUF indirme ~912 MB + ilk model yükleme ~2–5 dk → **boş VM’den ~30–60 dk** (bandwidth’e bağlı).

---

## Kapı 3 — Rollback tatbiki (dry run)

Amaç: **Gerçek flip’i yapmadan** veya staging’de **bilinçli geri alma** ile `[BITNET_DEFAULT_FLIP.md](BITNET_DEFAULT_FLIP.md)` §3’ün **ölçülebilir** olduğunu kanıtlamak.

**Runbook:** `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` (BitNet → Qwen, health/verify, RTO tablosu).

**Checklist**

- Tatbikat **tarihi** ve **sorumlu** kaydedildi — `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §4.
- BitNet profili **çalışır** durumda iken baseline alındı (`/v1/models` BitNet model adı).
- Rollback: BitNet `compose down` → Qwen konteyner → `curl` **200** (`[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §5).
- `**verify:lifecycle-chain` PASS** (üstteki burn-in; rollback HTTP tatbikatından bağımsız tam zincir kanıtı).
- **RTO** sıcak yol (~60–90 s) §4’e işlendi; soğuk yol indirme süresi baskın.
- Öğrenme: `libgomp1` + entrypoint CRLF — `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §5.

---

## Üç kapı birlikte — “flip” onayı


| Kapı                 | Durum                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 Pin’li matris      | **Tamam** — `/v1/models` **200** + **SHA256** `[BITNET_CHECKSUM_ARCHIVE.md](BITNET_CHECKSUM_ARCHIVE.md)` + `verify` **PASS** |
| 2 Linux/Docker repro | **Tamam** — compose + tam stack (`/ready` + gateway) + BitNet **200**                                                        |
| 3 Rollback tatbiki   | **Tamam** — `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)` §4–§5                                                     |


**Onaylayan (isim / rol / tarih):** altyapı burn-in — **2026-04-14** — üstteki `OFFICIAL_VERIFY_LINE` + checksum dosyası.

---

## Flip sonuç raporu (şablon)

Üretim/staging flip veya hazırlık özeti bu tabloya işlensin:


| Soru                               | Cevap (burn-in sonrası)                                                    |
| ---------------------------------- | -------------------------------------------------------------------------- |
| Pin’li runtime matrisi tamam mı?   | **Evet** — HTTP **200** + **SHA256** arşivi + `verify` **PASS**            |
| Linux/Docker doğrulaması tamam mı? | **Evet** — aynı host’ta infra + BitNet + backend                           |
| Rollback tatbiki tamam mı?         | **Evet** — `[BITNET_ROLLBACK_DRILL.md](BITNET_ROLLBACK_DRILL.md)`          |
| BitNet default flip uygulandı mı?  | **Altyapı doğrulaması tamam**; **prod** ingress/secret dağıtımı ayrı karar |
| Qwen fallback hazır mı?            | **Önceki tur HTTP kanıtı** + runbook                                       |
| Release sonrası sağlık durumu ne?  | **9080** healthy, **3000** ready, **8080** models **200**, **verify=PASS** |


---

**Başarı kriteri (repo burn-in):** Üç kapı + checksum + aynı host `verify` **kapatıldı** (**2026-04-14**). **Sonraki adım (gate değil):** **staging/prod** ortamında aynı prosedürün **release icrası** — ingress, secret store, hedef env — `[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)`; `[RUNTIME_PROFILES.md](RUNTIME_PROFILES.md)` ile aynı çerçeve.
