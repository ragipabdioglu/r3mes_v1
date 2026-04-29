# Adapter önbelleği ve hot-swap (ai-engine)

Kısa referans: LoRA **GGUF** dosyasının yerel dosya sistemi ile **llama-server** içindeki slot arasındaki yaşam döngüsü. Identity (`adapter_id` → CID) çözümlemesi **bu belgede yok**; backend / uygulama katmanında kalır.

Canlı çıkarım + format kanıtı: [LIVE_SMOKE.md](LIVE_SMOKE.md).

## Önbellek (artifact)

- **Dizin:** `R3MES_ADAPTER_CACHE_DIR` (varsayılan `artifacts/adapter_cache`).
- **Dosya adı:** `{sanitized_adapter_cid}.gguf` — CID’deki `/` ve `\` karakterleri `_` ile değiştirilir.
- **İsabet:** Dosya varsa IPFS çağrısı yapılmaz; `ensure_adapter_gguf` anında döner.
- **Kaçırma:** `IPFS_GATEWAY/ipfs/{cid}` üzerinden `download_with_retries` (senkron `httpx`, `R3MES_DOWNLOAD_MAX_ROUNDS` deneme, üstel bekleme).

## Geçersiz kilit ve yeniden kullanım

- **Otomatik invalidation yok:** Dosya varlığı “tamamlandı” kabul edilir. CID aynı kaldığı sürece aynı dosya kullanılır.
- **Zorla yeniden indirme:** İlgili `.gguf` dosyasını silmek yeterlidir; sonraki istekte yeniden indirilir.
- **CID değişimi:** Farklı CID → farklı dosya adı; eski dosya diskte kalabilir (manuel temizlik).

## Global lock

- Tüm isteklerde **tek** `asyncio.Lock` (`_lora_lock`): aynı anda yalnızca bir istek indirme + hot-swap + (stream modunda) tam akışı çalıştırır.
- Eşzamanlı istekler sıraya girer; log’da `lock_wait_ms` ile görünür.

## Hot-swap (lora-adapters)

- **POST** `{llama_public_base}/lora-adapters`
- **Gövde:** `id` = `R3MES_LORA_ADAPTER_SLOT_ID` (varsayılan `0`), `path` = önbellekteki GGUF yolu, `scale` = `R3MES_LORA_SCALE`.
- **Hata:** HTTP 502/503 ve `detail` içinde `stage=lora_hot_swap`, `category=llama_inference`.

## Gözlemlenebilirlik

- **Non-stream 200:** Yanıt başlıkları `X-R3MES-Adapter-Cache`, `X-R3MES-Lock-Wait-Ms`, `X-R3MES-Adapter-Resolve-Ms`, `X-R3MES-Lora-Swap-Ms`, `X-R3MES-Lora-Slot`.
- **Stream:** Başlıklar tam zamanlama içermez (ASGI akışı kısıtı); aynı bilgi **sunucu loglarında** `r3mes_inference` satırında.
- İsteğe bağlı **`X-Request-ID`**: log satırındaki `request_id` ile eşleştirme.

## Zaman aşımı ve yeniden deneme

| Bileşen | Davranış |
|---------|----------|
| IPFS indirme | `R3MES_CONNECT_TIMEOUT`, `R3MES_READ_TIMEOUT`, `R3MES_DOWNLOAD_MAX_ROUNDS` |
| lora-adapters POST | Sabit 120 s `httpx` timeout |
| Upstream chat | `R3MES_CONNECT_TIMEOUT` / `R3MES_READ_TIMEOUT` |

Hata gövdesinde `cause` alanı: `timeout`, `http_status`, `transport`, `os_error`, `unknown` (httpx/OS türüne göre).

## Operasyonel testler (smoke)

Gerçek llama/IPFS gerekmez; `httpx.MockTransport` ve modül içi `ensure_adapter_gguf` yamalarıyla doğrulanır:

| Dosya | Ne kanıtlar |
|-------|-------------|
| `tests/test_proxy_operational.py` | Global lock ile seri kritik bölüm; ikinci istekte `X-R3MES-Lock-Wait-Ms`; hata `detail` içinde `stage` / `category` / `cause`; non-stream başlık tutarlılığı; stream sabit tanı başlıkları |
| `tests/test_http_download_retries.py` | `download_with_retries` tüm denemeleri tüketince son hata; geçici `ConnectError` sonrası başarı |

`pytest-asyncio` ile `@pytest.mark.asyncio` kullanılır; her testte `asyncio.Lock` yenilenir (event loop uyumu).
