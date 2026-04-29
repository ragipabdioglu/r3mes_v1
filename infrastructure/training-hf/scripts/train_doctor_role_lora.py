from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import torch
import yaml
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForSeq2Seq,
    Trainer,
    TrainingArguments,
)


ROOT = Path(__file__).resolve().parents[3]


def log_stage(message: str) -> None:
    print(f"[stage] {message}", flush=True)


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


def parse_dtype(name: str) -> torch.dtype:
    mapping = {
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
        "float32": torch.float32,
    }
    if name not in mapping:
        raise ValueError(f"Desteklenmeyen dtype: {name}")
    return mapping[name]


def render_chat(tokenizer: AutoTokenizer, sample: dict[str, Any]) -> str:
    if sample.get("messages"):
        return tokenizer.apply_chat_template(
            sample["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
    text = sample.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Kayitta messages veya text yok")
    return text


def render_prompt_only(tokenizer: AutoTokenizer, sample: dict[str, Any]) -> str:
    messages = sample.get("messages")
    if isinstance(messages, list) and messages:
        prompt_messages = messages[:-1]
        if prompt_messages:
            return tokenizer.apply_chat_template(
                prompt_messages,
                tokenize=False,
                add_generation_prompt=True,
            )
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--model-path", default=None)
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = ROOT / config_path
    config = load_config(config_path)

    model_name = resolve_model_name(config["model_name_or_path"], args.model_path)
    train_file = resolve_path(config["dataset"]["train_file"])
    dev_file = resolve_path(config["dataset"]["dev_file"])
    max_seq_length = int(config["dataset"]["max_seq_length"])
    output_dir = resolve_path(args.output_dir or config["output"]["output_dir"])

    quant = config["quantization"]
    log_stage("loading quantization config")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=bool(quant["load_in_4bit"]),
        bnb_4bit_quant_type=str(quant["bnb_4bit_quant_type"]),
        bnb_4bit_use_double_quant=bool(quant["bnb_4bit_use_double_quant"]),
        bnb_4bit_compute_dtype=parse_dtype(str(quant["bnb_4bit_compute_dtype"])),
    )

    log_stage(f"loading tokenizer: {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    log_stage(f"loading model: {model_name}")
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        trust_remote_code=True,
        quantization_config=bnb_config,
        device_map="auto",
    )
    model.config.use_cache = False

    if config["training"].get("gradient_checkpointing", False):
        log_stage("enabling gradient checkpointing")
        model.gradient_checkpointing_enable()

    log_stage("preparing k-bit training")
    model = prepare_model_for_kbit_training(model)

    lora = config["lora"]
    peft_config = LoraConfig(
        r=int(lora["r"]),
        lora_alpha=int(lora["alpha"]),
        lora_dropout=float(lora["dropout"]),
        target_modules=list(lora["target_modules"]),
        bias="none",
        task_type="CAUSAL_LM",
    )
    log_stage("attaching LoRA adapter")
    model = get_peft_model(model, peft_config)

    log_stage("loading dataset")
    dataset = load_dataset(
        "json",
        data_files={"train": train_file, "dev": dev_file},
    )

    def tokenize_row(row: dict[str, Any]) -> dict[str, Any]:
        text = render_chat(tokenizer, row)
        encoded = tokenizer(
            text,
            truncation=True,
            max_length=max_seq_length,
            padding=False,
        )
        labels = list(encoded["input_ids"])
        prompt_text = render_prompt_only(tokenizer, row)
        if prompt_text:
            prompt_ids = tokenizer(
                prompt_text,
                truncation=True,
                max_length=max_seq_length,
                padding=False,
            )["input_ids"]
            prompt_length = min(len(prompt_ids), len(labels))
            labels[:prompt_length] = [-100] * prompt_length
        encoded["labels"] = labels
        return encoded

    log_stage("tokenizing dataset")
    tokenized = dataset.map(
        tokenize_row,
        remove_columns=dataset["train"].column_names,
        desc="Tokenizing",
    )

    train_cfg = config["training"]
    log_stage("building training arguments")
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=int(train_cfg["num_train_epochs"]),
        per_device_train_batch_size=int(train_cfg["per_device_train_batch_size"]),
        per_device_eval_batch_size=int(train_cfg["per_device_eval_batch_size"]),
        gradient_accumulation_steps=int(train_cfg["gradient_accumulation_steps"]),
        learning_rate=float(train_cfg["learning_rate"]),
        warmup_ratio=float(train_cfg["warmup_ratio"]),
        lr_scheduler_type=str(train_cfg["lr_scheduler_type"]),
        logging_steps=int(train_cfg["logging_steps"]),
        eval_strategy="steps",
        eval_steps=int(train_cfg["eval_steps"]),
        save_strategy="steps",
        save_steps=int(train_cfg["save_steps"]),
        save_total_limit=int(train_cfg["save_total_limit"]),
        weight_decay=float(train_cfg["weight_decay"]),
        max_grad_norm=float(train_cfg["max_grad_norm"]),
        fp16=bool(train_cfg["fp16"]),
        bf16=bool(train_cfg["bf16"]),
        gradient_checkpointing=bool(train_cfg["gradient_checkpointing"]),
        optim=str(train_cfg["optim"]),
        report_to="none",
        remove_unused_columns=False,
    )
    if args.max_steps is not None:
        training_args.max_steps = int(args.max_steps)

    log_stage("creating trainer")
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["dev"],
        data_collator=DataCollatorForSeq2Seq(
            tokenizer=tokenizer,
            model=model,
            label_pad_token_id=-100,
            padding=True,
        ),
    )

    log_stage("starting train()")
    trainer.train()
    log_stage("saving adapter")
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)

    summary = {
        "output_dir": output_dir,
        "train_rows": len(dataset["train"]),
        "dev_rows": len(dataset["dev"]),
        "max_seq_length": max_seq_length,
        "model_name_or_path": model_name,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
