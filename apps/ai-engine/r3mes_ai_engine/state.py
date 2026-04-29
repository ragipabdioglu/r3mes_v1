from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from subprocess import Popen
from typing import Any


@dataclass
class AppState:
    """Donmuş GGUF yolu ve llama-server süreci (PyTorch tensörü tutulmaz)."""

    frozen_gguf_path: Path | None = None
    frozen_core_source: str = "uninitialized"
    llama_process: Popen[Any] | None = None
    hf_runtime: Any | None = None
    reranker_runtime: Any | None = None
    embedding_runtime: Any | None = None
