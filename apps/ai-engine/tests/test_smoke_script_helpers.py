"""smoke_ai_engine.py içindeki triage yardımcıları — subprocess/HTTP yok."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def smoke_mod():
    root = Path(__file__).resolve().parents[1]
    path = root / "scripts" / "smoke_ai_engine.py"
    spec = importlib.util.spec_from_file_location("smoke_ai_engine_script", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_detail_triage_extracts_stage_and_hint(smoke_mod) -> None:
    raw = json.dumps(
        {
            "detail": {
                "stage": "adapter_download",
                "category": "artifact_fetch",
                "cause": "timeout",
                "adapter_cid": "bafyx",
            }
        }
    ).encode()
    triage, hint = smoke_mod._detail_triage(raw)
    assert triage is not None
    assert triage["stage"] == "adapter_download"
    assert hint is not None
    assert "IPFS" in hint or "gateway" in hint


def test_detail_triage_unknown_body(smoke_mod) -> None:
    triage, hint = smoke_mod._detail_triage(b"not json")
    assert triage is None and hint is None


def test_verify_completion_ok(smoke_mod) -> None:
    raw = json.dumps(
        {
            "id": "1",
            "choices": [{"message": {"role": "assistant", "content": "hello smoke"}}],
        }
    ).encode()
    ok, prev = smoke_mod.verify_openai_completion_body(raw)
    assert ok and "hello" in prev


def test_verify_completion_empty(smoke_mod) -> None:
    raw = json.dumps({"choices": [{"message": {"content": ""}}]}).encode()
    ok, err = smoke_mod.verify_openai_completion_body(raw)
    assert not ok and err == "empty_content"


def test_cache_pattern(smoke_mod) -> None:
    assert smoke_mod._cache_pattern("miss", "hit") == "miss_then_hit"
    assert smoke_mod._cache_pattern("hit", "hit") == "hit_hit"
