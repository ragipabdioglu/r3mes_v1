# Canlı çıkarım kanıtı (Faz 7–8)

**Amaç:** Donmuş base GGUF + IPFS’ten LoRA **GGUF** + `llama-server` zincirinde gerçek bir **chat.completion** yanıtı ve (mümkünse) önbellek davranışını göstermek — mock ile “çalışıyor” varsayımı değil.

## Desteklenen adapter biçimi (tek cümle)

Artefakt **llama.cpp / llama-server’ın `lora-adapters` ile yükleyebildiği LoRA ağırlıkları içeren tek bir `.gguf` dosyası** olmalıdır; IPFS CID bu dosyanın içerik adresidir — başka format (safetensors-only, ham tensör) bu proxy yolunda desteklenmez.

## Önkoşullar

- `R3MES_SKIP_LLAMA` kapalı; `llama-server` ve IPFS gateway erişilir.
- Ürün/onay ile aynı **geçerli `adapter_cid`** (LoRA GGUF).

## Kanıt prosedürü

`apps/ai-engine` içinde:

```bash
set R3MES_SMOKE_ADAPTER_CID=<onaylı_cid>
python scripts/smoke_ai_engine.py --prove-inference
```

Beklenen:

1. `OK: health`
2. İki ardışık round, ikisi de HTTP **200**
3. Her round’da `assistant_preview` satırı — boş olmayan model çıktısı
4. Soğuk önbellekte genelde **round1 `X-R3MES-Adapter-Cache: miss`**, **round2 `hit`**; `LIVE_PROOF_OK: cache_pattern=miss_then_hit`
5. Sunucu loglarında aynı istekler için `r3mes_inference` (isteğe bağlı `X-Request-ID`)

`--json` ile `JSON_SUMMARY` içinde `live_proof.completion_verified`, `cache_pattern`, `rounds` kayıt altına alınır.

## Başarısızlık

| Çıkış | Anlam |
|-------|--------|
| `3` | Chat HTTP hatası (`detail` triage) |
| `4` | 200 ama `choices[].message.content` boş / JSON uyumsuz (upstream veya model) |

## Tek istek (hafif)

```bash
python scripts/smoke_ai_engine.py
```

200 ise `assistant_preview` ve tanı başlıkları yazdırılır; tam kanıt için `--prove-inference` tercih edin.

Kimlik çözümleme backend’dedir; bu adımlar **doğrudan ai-engine** üzerindendir.
