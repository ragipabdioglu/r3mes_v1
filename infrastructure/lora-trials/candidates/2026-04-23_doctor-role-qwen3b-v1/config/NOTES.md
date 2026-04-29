# Notes

- Base model kesinlikle Qwen2.5-3B'dir; 0.5B hatları bu aday için kullanılmaz.
- GPU hedefi: `infrastructure/llama-runtime/win-vulkan-x64/llama-finetune-lora.exe`
- RTX 4050 6 GB için hız/başarı dengesi:
  - `rank=8`
  - `alpha=16`
  - `modules=attn_q,attn_v`
  - `epochs=2`
  - `context=384`
  - `batch=4`
  - `ubatch=4`
  - `lr=1.5e-4`
  - `scheduler=cosine`
  - `warmup_ratio=0.03`

Neden:
- Dataset rol/stil odaklı; büyük rank gerektirmiyor.
- 3B Q5 base + Vulkan + 6 GB VRAM için `-c 384`, `-b 4` daha dengeli; `256` fazla örnek skip ediyordu.
- Amaç en iyi genel benchmark değil, davranış LoRA'sı.
