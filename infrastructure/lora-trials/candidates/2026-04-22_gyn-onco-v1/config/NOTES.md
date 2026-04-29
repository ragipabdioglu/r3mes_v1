# gyn-onco-v1 notes

Source dataset:
- `jinekolojik_onkoloji_lora.jsonl`

Trainer mapping:
- user `q_proj,v_proj` -> `attn_q,attn_v`
- `lora_r=8`
- `lora_alpha=16`
- `epochs=3`

Not used because current QVAC trainer does not expose them:
- `lora_dropout`
- `gradient_checkpointing`
- `paged_adamw_8bit`

Runtime choice:
- `infrastructure/llama-runtime/win-vulkan-x64/llama-finetune-lora.exe`
- GPU path uses QVAC Vulkan backend on Windows
- validated device detection:
  - `NVIDIA GeForce RTX 4050 Laptop GPU`

Context choice:
- `-c 512`
- user suggested 256, but this dataset includes long medical questions and 256 would truncate too aggressively

GPU offload:
- `-ngl 999`
- use the Vulkan backend instead of the CPU-only bundle
