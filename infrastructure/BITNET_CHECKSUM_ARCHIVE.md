# BitNet / QVAC — checksum arşivi (pin doğrulama)

> **Legacy / R&D notu:** Bu belge aktif Qwen2.5-3B + RAG golden path doğrulama yolu değildir. Yalnız tarihî BitNet/QVAC artefakt bütünlüğü veya izole R&D denemesi için kullanılır.

**Amaç:** İkili ve GGUF için **yeniden indirme sonrası** bütünlük kontrolü; [`BITNET_QVAC_PRODUCTION_MATRIX.md`](BITNET_QVAC_PRODUCTION_MATRIX.md) ile aynı release hattı.

**Tek dosya (makine okunur):** [`docker/SHA256SUMS.bitnet-pin.txt`](docker/SHA256SUMS.bitnet-pin.txt)

---

## Üretim (yenileme)

| Artefakt | Komut (örnek) |
|----------|----------------|
| **GitHub zip** | İndirdikten sonra: `Get-FileHash -Algorithm SHA256 llama-b7349-bin-ubuntu-x64.zip` (Windows) veya `sha256sum` (Linux) |
| **GGUF** | `Get-FileHash` / `sha256sum` — `infrastructure/docker/models/bitnet/` |
| **Konteyner ikili** | `docker run --rm --entrypoint sh r3mes/bitnet-qvac:b7349 -c "sha256sum /opt/qvac/llama-server /opt/qvac/libllama.so.0.0.7349"` |

**Not:** Aynı `b7349` zip’i farklı indirme oturumunda **bayt bayt aynı** ise SHA256 değişmez; release yenilenirse bu dosya ve matris birlikte güncellenir.

---

## Kayıt (2026-04-14)

| Öğe | SHA256 (64 hex) |
|-----|------------------|
| `llama-b7349-bin-ubuntu-x64.zip` | `73dc3d43c71ad9f6d71b49a2349cf345cf48632cfc42b14ab15e81b75e645951` |
| `llama-server` (imaj `/opt/qvac`) | `777d2f473b319e46edb431b36619eb7da446fab1607ce15c312242e9e92b3bfa` |
| `libllama.so.0.0.7349` | `36c77b0a6a173bee20637dcdea7bc011c7e5ec4587a01f678a96af4b8eee28c9` |
| `1bitLLM-bitnet_b1_58-xl-tq2_0.gguf` | `36b16cd2dde3bc34d7a17e14cf4530c508de89aa1836e5223e4c087d8f2d226d` |
| `slot0.gguf` (LoRA örnek pin) | `bbe998c0587adf843db34439db30eab637937da6231714659b624bfaf31e13a8` |

**İlişki:** [`BITNET_PINNED_ENV_MATRIX.md`](BITNET_PINNED_ENV_MATRIX.md), [`BITNET_FLIP_FINAL_GATES.md`](BITNET_FLIP_FINAL_GATES.md).
