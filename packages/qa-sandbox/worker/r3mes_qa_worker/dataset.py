from __future__ import annotations

import json
from importlib import resources
from pathlib import Path
from typing import Any


def load_hidden_rows(dataset_path: str | None) -> list[dict[str, Any]]:
    """Gizli benchmark satırlarını yükler (prompt + reference)."""
    if dataset_path:
        p = Path(dataset_path)
        raw = p.read_text(encoding="utf-8")
    else:
        pkg = resources.files("r3mes_qa_worker")
        raw = (pkg / "data" / "hidden_dataset.json").read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("hidden_dataset.json bir dizi olmalıdır.")
    return data
