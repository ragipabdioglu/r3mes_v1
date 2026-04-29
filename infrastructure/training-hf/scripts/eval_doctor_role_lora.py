from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any

import torch
import yaml
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


ROOT = Path(__file__).resolve().parents[3]


def load_config(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def resolve_path(value: str) -> str:
    path = Path(value)
    if not path.is_absolute():
        path = ROOT / path
    return str(path)


def resolve_model_name(config_value: str, cli_value: str | None) -> str:
    override = cli_value or os.environ.get("R3MES_HF_MODEL_PATH")
    if not override:
        return config_value
    path = Path(override)
    return str(path if path.is_absolute() else (ROOT / path))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=160)
    parser.add_argument("--model-path", default=None)
    parser.add_argument("--adapter-dir", default=None)
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = ROOT / config_path
    config = load_config(config_path)

    model_name = resolve_model_name(config["model_name_or_path"], args.model_path)
    adapter_dir = resolve_path(args.adapter_dir or config["output"]["output_dir"])
    prompts = list(config.get("evaluation", {}).get("prompts", []))

    tokenizer = AutoTokenizer.from_pretrained(adapter_dir, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    quant = config["quantization"]
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=bool(quant["load_in_4bit"]),
        bnb_4bit_quant_type=str(quant["bnb_4bit_quant_type"]),
        bnb_4bit_use_double_quant=bool(quant["bnb_4bit_use_double_quant"]),
        bnb_4bit_compute_dtype=torch.float16,
    )

    base_model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )
    model = PeftModel.from_pretrained(base_model, adapter_dir)
    model.eval()

    system_prompt = (
        "Sen sakin, profesyonel ve guvenli bir doktorsun. Turkce, net ve olculu cevap ver. "
        "Kesin tani koyuyormus gibi konusma; gerektiginde muayene, tetkik veya acil basvuru oner."
    )

    def fallback_render(messages: list[dict[str, str]]) -> str:
        parts = []
        for message in messages:
            parts.append(f"<|im_start|>{message['role']}\n{message['content']}<|im_end|>")
        parts.append("<|im_start|>assistant\n")
        return "\n".join(parts)

    for index, prompt in enumerate(prompts, start=1):
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        try:
            rendered = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:
            rendered = fallback_render(messages)
        inputs = tokenizer(rendered, return_tensors="pt").to(model.device)
        with torch.inference_mode():
            output = model.generate(
                **inputs,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                eos_token_id=tokenizer.eos_token_id,
                pad_token_id=tokenizer.pad_token_id,
            )
        generated = output[0][inputs["input_ids"].shape[1] :]
        text = tokenizer.decode(generated, skip_special_tokens=True).strip()
        print(f"[{index}] Prompt: {prompt}")
        print(text)
        print("-" * 80)


if __name__ == "__main__":
    main()
