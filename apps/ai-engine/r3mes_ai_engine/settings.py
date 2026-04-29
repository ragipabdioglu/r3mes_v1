from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="R3MES_", env_file=".env", extra="ignore")

    inference_backend: Literal["llama_cpp", "transformers_peft"] = Field(
        default="llama_cpp",
        description="Aktif inference backend'i. llama_cpp legacy, transformers_peft yeni ana yol.",
    )

    ipfs_gateway: str = Field(
        default="http://127.0.0.1:9080",
        description="IPFS HTTP gateway (llama ile 8080 çakışmasını önlemek için varsayılan 9080)",
    )
    frozen_core_cid: str | None = Field(default=None, description="Donmuş GGUF IPFS CID")
    frozen_core_sha256: str | None = Field(default=None, description="İsteğe bağlı çekirdek SHA-256")
    frozen_core_hf_url: str | None = Field(
        default=(
            "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/"
            "resolve/main/qwen2.5-3b-instruct-q5_k_m.gguf"
        ),
        description="CID yoksa kullanılacak doğrudan GGUF indirme URL'i",
    )
    frozen_gguf_filename: str = "qwen2.5-3b-instruct-q5_k_m.gguf"
    frozen_cache_dir: Path = Field(default=Path("artifacts/frozen"))

    skip_llama: bool = Field(default=False, description="Test: llama-server başlatma / indirme atla")
    frozen_gguf_local_path: Path | None = Field(
        default=None,
        description="Yerel donmuş GGUF yolu (skip_llama veya manuel)",
    )

    llama_server_bin: str = Field(default="llama-server", description="PATH üzerinde llama-server")
    llama_internal_host: str = "127.0.0.1"
    llama_internal_port: int = Field(default=8080, description="llama-server dinleme portu")
    llama_n_gpu_layers: int = Field(
        default=0,
        description="llama-server için GPU'ya offload edilecek layer sayısı; 0 CPU-only, 999 tam offload denemesi",
    )
    llama_ctx_size: int = Field(default=4096, description="llama-server context window boyutu")
    lora_init_without_apply: bool = True
    lora_slot_path: Path | None = Field(
        default=None,
        description="llama-server başlatılırken --lora ile yüklenecek GGUF slot dosyası.",
    )

    adapter_cache_dir: Path = Field(default=Path("artifacts/adapter_cache"))
    chunk_size: int = 1024 * 1024
    download_max_rounds: int = 8
    connect_timeout: float = 30.0
    read_timeout: float = 600.0

    default_model_name: str = "qwen2.5-3b-instruct-gguf"
    hf_model_name_or_path: str = Field(
        default="Qwen/Qwen2.5-3B-Instruct",
        description="Transformers/PEFT inference için HF model adı veya yerel yol.",
    )
    hf_model_local_path: Path | None = Field(
        default=None,
        description="Transformers inference için opsiyonel yerel model snapshot yolu.",
    )
    hf_load_in_4bit: bool = Field(default=True, description="Transformers backend için 4-bit yükleme")
    hf_max_new_tokens_default: int = Field(default=256, description="Transformers backend varsayılan max_new_tokens")
    hf_device_map: str = Field(default="auto", description="Transformers device_map değeri")
    hf_low_cpu_mem_usage: bool = Field(
        default=True,
        description="Transformers model yüklemede CPU/RAM baskısını azalt.",
    )
    hf_local_files_only: bool = Field(
        default=True,
        description="Yerel snapshot varsa ağ erişimine gitmeden yalnız local dosyaları kullan.",
    )
    hf_offload_folder: Path = Field(
        default=Path("artifacts/hf_offload"),
        description="Transformers offload_state_dict için disk klasörü.",
    )
    reranker_model_name_or_path: str = Field(
        default="BAAI/bge-reranker-base",
        description="Reranker model adı veya yerel snapshot yolu.",
    )
    reranker_local_path: Path | None = Field(
        default=None,
        description="Reranker için opsiyonel yerel model snapshot yolu.",
    )
    reranker_device: str = Field(
        default="cpu",
        description="Reranker cihazı: cpu veya cuda.",
    )
    reranker_local_files_only: bool = Field(
        default=True,
        description="Reranker modelini yalnız yerel snapshot'tan yükle.",
    )
    reranker_max_length: int = Field(
        default=512,
        description="Reranker tokenizer max_length değeri.",
    )
    embedding_model_name_or_path: str = Field(
        default="BAAI/bge-m3",
        description="Embedding model adı veya yerel snapshot yolu.",
    )
    embedding_local_path: Path | None = Field(
        default=None,
        description="Embedding modeli için opsiyonel yerel snapshot yolu.",
    )
    embedding_device: str = Field(
        default="cpu",
        description="Embedding cihazı: cpu veya cuda.",
    )
    embedding_local_files_only: bool = Field(
        default=True,
        description="Embedding modelini yalnız yerel snapshot'tan yükle.",
    )
    embedding_max_length: int = Field(
        default=8192,
        description="Embedding tokenizer max_length değeri.",
    )
    lora_adapter_slot_id: int = 0
    lora_scale: float = 1.0
    lora_copy_target_override: Path | None = Field(
        default=None,
        description="İndirilen LoRA GGUF'un yazılacağı yol (--lora ile aynı); boşsa GET /lora-adapters path",
    )


def get_settings() -> Settings:
    return Settings()
