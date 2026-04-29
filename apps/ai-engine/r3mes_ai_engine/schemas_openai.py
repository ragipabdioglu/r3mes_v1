"""OpenAI Chat Completions uyumlu istek — R3MES uzantıları: adapter_cid + context alanları."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None


class ChatCompletionRequest(BaseModel):
    """
    OpenAI `POST /v1/chat/completions` gövdesi + opsiyonel R3MES alanları.

    **Contract (ORTAK):**
    - `adapter_cid` varsa, IPFS üzerinden çekilecek LoRA **.gguf** artefaktının içerik kimliğidir
      (CIDv0 `Qm…` veya CIDv1 `bafy…`).
    - `system_context` ve `retrieved_context`, backend tarafından önceden derlenmiş bağlamı taşıyan
      düz metin alanlarıdır. ai-engine retrieval yapmaz; bu alanları yalnızca upstream mesaja dönüştürür.
    """

    model: str | None = None
    messages: list[ChatMessage]
    runtime: Literal["llama_cpp", "transformers_peft"] | None = Field(
        default=None,
        description="İsteğe bağlı runtime override; yoksa ai-engine ayarı kullanılır.",
    )
    adapter_cid: str | None = Field(
        default=None,
        description="LoRA GGUF dosyasının IPFS CID değeri (tek kaynak gerçek).",
    )
    adapter_path: str | None = Field(
        default=None,
        description="Transformers/PEFT runtime için yerel adapter klasörü.",
    )
    system_context: str | None = Field(
        default=None,
        description="Backend tarafından derlenmiş ek sistem bağlamı; upstream'de system message olarak eklenir.",
    )
    retrieved_context: str | None = Field(
        default=None,
        description="Backend retrieval çıktısı; upstream'de system message olarak eklenir.",
    )
    temperature: float = 0.7
    max_tokens: int = 256
    top_p: float | None = None
    n: int = 1
    stop: str | list[str] | None = None
    user: str | None = None
    stream: bool = False

    @field_validator("adapter_cid", "adapter_path", mode="before")
    @classmethod
    def _strip_nullable_string(cls, v: object) -> object:
        if isinstance(v, str):
            stripped = v.strip()
            return stripped or None
        return v

    @field_validator("adapter_cid")
    @classmethod
    def _non_empty_adapter_cid(cls, v: str | None) -> str | None:
        if v is not None and not v:
            raise ValueError("adapter_cid boş olamaz; LoRA artefaktı için geçerli bir IPFS CID verin.")
        return v
