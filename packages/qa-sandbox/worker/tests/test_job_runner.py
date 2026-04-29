from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from r3mes_qa_worker.job_runner import run_benchmark_job
from r3mes_qa_worker.settings import Settings


@pytest.fixture
def settings_high(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    ds = tmp_path / "hidden.json"
    ds.write_text(
        '[{"id":"1","prompt":"p","reference":"referans cevap metni tam."}]',
        encoding="utf-8",
    )
    monkeypatch.setenv("R3MES_BACKEND_QA_WEBHOOK_URL", "http://example.invalid/no")
    return Settings(
        hidden_dataset_path=str(ds),
        score_threshold=75.0,
        backend_qa_webhook_url="http://example.invalid/no",
        qa_llama_base_url="http://127.0.0.1:9",
    )


def test_run_job_approved_with_llama_mocks(
    settings_high: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, Any] = {}

    def fake_download(*_a: Any, **_k: Any) -> int:
        return 42

    def fake_register(*_a: Any, **_k: Any) -> None:
        return None

    def fake_chat(*_a: Any, **_k: Any) -> str:
        return "referans cevap metni tam."

    def fake_post(url: str, payload: dict[str, Any], *, timeout_sec: float, webhook_secret: str | None = None) -> None:
        captured["payload"] = payload

    monkeypatch.setattr("r3mes_qa_worker.job_runner.download_ipfs_artifact", fake_download)
    monkeypatch.setattr("r3mes_qa_worker.job_runner.register_lora_adapter", fake_register)
    monkeypatch.setattr("r3mes_qa_worker.job_runner.chat_completion_text", fake_chat)
    monkeypatch.setattr("r3mes_qa_worker.job_runner.post_qa_result", fake_post)

    out = run_benchmark_job(
        {"jobId": "j1", "adapterCid": "bafyTEST", "adapterDbId": "adb-1"},
        settings_high,
    )
    assert out["status"] == "approved"
    assert out["score"] >= 75.0
    assert captured["payload"]["jobId"] == "j1"
    assert captured["payload"]["adapterDbId"] == "adb-1"


def test_run_job_rejected_low_match(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = tmp_path / "hidden.json"
    ds.write_text(
        '[{"id":"1","prompt":"p","reference":"uzun referans metni bir iki üç dört beş altı yedi sekiz dokuz on."}]',
        encoding="utf-8",
    )

    s = Settings(
        hidden_dataset_path=str(ds),
        score_threshold=75.0,
        backend_qa_webhook_url="http://example.invalid/no",
        qa_llama_base_url="http://127.0.0.1:9",
    )

    monkeypatch.setattr(
        "r3mes_qa_worker.job_runner.download_ipfs_artifact",
        lambda *a, **k: 10,
    )
    monkeypatch.setattr("r3mes_qa_worker.job_runner.register_lora_adapter", lambda *a, **k: None)
    monkeypatch.setattr(
        "r3mes_qa_worker.job_runner.chat_completion_text",
        lambda *a, **k: "kısa ve alakasız",
    )
    monkeypatch.setattr("r3mes_qa_worker.job_runner.post_qa_result", lambda *a, **k: None)

    out = run_benchmark_job({"jobId": "j2", "adapterCid": "bafyX", "adapterDbId": "adb-2"}, s)
    assert out["status"] == "rejected"
    assert out["score"] < 75.0


def test_run_job_rejected_llama_unreachable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = tmp_path / "hidden.json"
    ds.write_text(
        '[{"id":"1","prompt":"p","reference":"referans cevap metni tam."}]',
        encoding="utf-8",
    )

    s = Settings(
        hidden_dataset_path=str(ds),
        score_threshold=75.0,
        backend_qa_webhook_url="http://example.invalid/no",
        qa_llama_base_url="http://127.0.0.1:9",
    )

    captured: dict[str, Any] = {}

    def fake_post(url: str, payload: dict[str, Any], *, timeout_sec: float, webhook_secret: str | None = None) -> None:
        captured["payload"] = payload

    monkeypatch.setattr("r3mes_qa_worker.job_runner.download_ipfs_artifact", lambda *a, **k: 10)
    monkeypatch.setattr("r3mes_qa_worker.job_runner.register_lora_adapter", lambda *a, **k: None)
    monkeypatch.setattr(
        "r3mes_qa_worker.job_runner.chat_completion_text",
        lambda *a, **k: (_ for _ in ()).throw(ConnectionError("refused")),
    )
    monkeypatch.setattr("r3mes_qa_worker.job_runner.post_qa_result", fake_post)

    out = run_benchmark_job({"jobId": "j3", "adapterCid": "bafyZ", "adapterDbId": "adb-3"}, s)
    assert out["status"] == "rejected"
    assert out["score"] == 0.0
    assert out["error"] is not None
    assert "llama_inference_failed" in (out["error"] or "")
    assert captured["payload"]["metrics"].get("failure_stage") == "llama_inference"
    assert captured["payload"]["metrics"].get("qa_outcome") == "failed"
