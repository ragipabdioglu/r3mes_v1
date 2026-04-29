# gyn-onco-v1

User-provided Turkish gynecologic oncology dataset trial.

Goal:
- fit a domain LoRA from `jinekolojik_onkoloji_lora.jsonl`
- keep the existing QVAC / llama-finetune-lora pipeline
- use the user's requested low-rank recipe where it maps cleanly to this trainer

Notes:
- this is a domain adapter, not a general Turkish-chat adapter
- GPU training is not enabled in the current repo runtime bundle; this run uses CPU backend
