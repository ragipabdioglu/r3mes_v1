from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="R3MES_", env_file=".env", extra="ignore")

    redis_url: str = Field(default="redis://127.0.0.1:6379/0")
    queue_mode: str = Field(default="list")
    list_queue_key: str = "r3mes-benchmark:jobs"
    stream_key: str = "r3mes-benchmark"
    consumer_group: str = "qa-workers"
    consumer_name: str = "worker-1"
    blpop_timeout_sec: int = 5

    ipfs_gateway: str = Field(default="http://127.0.0.1:9080")
    ipfs_download_connect_timeout_sec: float = Field(
        default=30.0,
        description="IPFS gateway TCP bağlantı zaman aşımı (saniye)",
    )
    ipfs_download_read_timeout_sec: float = Field(
        default=600.0,
        description="IPFS gateway gövde okuma zaman aşımı (saniye)",
    )
    backend_qa_webhook_url: str = Field(default="http://localhost:3000/v1/internal/qa-result")
    webhook_timeout_sec: float = 30.0
    qa_webhook_secret: str | None = Field(
        default=None,
        description=(
            "X-QA-HMAC (HMAC-SHA256) için paylaşılan gizli anahtar (R3MES_QA_WEBHOOK_SECRET). "
            "Worker `main` başında yok/boşsa uyarı ile çıkılır; backend ile aynı değer olmalıdır."
        ),
    )

    score_threshold: float = Field(default=75.0)
    hidden_dataset_path: str | None = None

    qa_llama_base_url: str = Field(
        default="http://127.0.0.1:8080",
        description="Benchmark sırasında gerçek yanıt üretmek için llama-server tabanı",
    )
    qa_model_name: str | None = Field(default=None, description="İsteğe bağlı model alanı")
    lora_slot_id: int = Field(
        default=0,
        description="llama-server --lora sırasındaki adaptör indeksi (ilk --lora → 0)",
    )
    lora_scale: float = 1.0
    qa_lora_copy_target: str | None = Field(
        default=None,
        description="İndirilen GGUF'un yazılacağı dosya yolu (llama-server --lora ile aynı olmalı); "
        "boşsa GET /lora-adapters içindeki path kullanılır",
    )

    qa_worker_log_file: Path | None = Field(
        default=None,
        description="Artefact / uzun testlerde stdout'a ek olarak UTF-8 dosyaya log (ör. logs/qa-worker.log)",
    )

    @model_validator(mode="after")
    def _strip_runtime_strings(self) -> "Settings":
        self.redis_url = self.redis_url.strip()
        self.ipfs_gateway = self.ipfs_gateway.strip()
        self.backend_qa_webhook_url = self.backend_qa_webhook_url.strip()
        self.qa_llama_base_url = self.qa_llama_base_url.strip()
        self.qa_model_name = self.qa_model_name.strip() if self.qa_model_name else None
        self.qa_webhook_secret = self.qa_webhook_secret.strip() if self.qa_webhook_secret else None
        self.qa_lora_copy_target = (
            self.qa_lora_copy_target.strip() if self.qa_lora_copy_target else None
        )
        return self


def get_settings() -> Settings:
    return Settings()
