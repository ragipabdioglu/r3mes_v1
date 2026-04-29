# Export — tek canonical çıktı (upload kaynağı)

**Eğitim bittikten sonra** yalnızca bu klasöre yazın; **`train/` buraya taşınmaz.**

## Beklenen dosyalar (export sonrası)

| Dosya | Açıklama |
|-------|----------|
| **`tr-v1.gguf`** | LoRA adapter GGUF (TQ2 uyumlu). **Repoya commit edilmez** — artefakt deposu / güvenilir disk. |
| **`tr-v1.gguf.sha256`** | `sha256sum` / `Get-FileHash` çıktısı; **upload öncesi zorunlu**. |
| **`EXPORT.md`** | Kullanılan export komutu, araç sürümü, tarih (kısa). |

**Dosya adı:** Adapter etiketi `tr-v1` = [config/NOTES.md](../config/NOTES.md) ile aynı kök.

Upload **yalnızca** bu klasördeki `.gguf` ile yapılır — [ARTIFACT_LAYOUT.md](../../../ARTIFACT_LAYOUT.md) §6 checklist.

## Windows: nereye yazılır, path riski

- **Mantıksal konum** (tüm platformlar): `candidates/<trial_id>/export/` — bu klasöre **tek** GGUF + `.sha256` + `EXPORT.md`.
- **Mutlak yol** OneDrive + `Masaüstü` gibi Unicode içeriyorsa, eğitim/export araçları bozulabilir; çözüm **ASCII çalışma kökü**, **`SUBST`** veya **8.3 kısa yol** — [ARTIFACT_LAYOUT.md §2.5](../../../ARTIFACT_LAYOUT.md).
- Upload öncesi **checksum kapısı** §6 ile aynı: dosya hangi sürücü harfiyle üretildiyse üretilsin, yüklemeden önce `.gguf` ile `.sha256` **byte eşleşmesi** zorunlu.
