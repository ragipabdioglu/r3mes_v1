from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch

import pytest

from r3mes_qa_worker.webhook import post_qa_result


def test_post_qa_result_sets_x_qa_hmac() -> None:
    payload = {"jobId": "j1", "score": 1.0, "z": 2, "a": 1}
    body = json.dumps({**payload, "threshold": 75.0}, sort_keys=True, separators=(",", ":")).encode("utf-8")
    expected = hmac.new(b"secret", body, hashlib.sha256).hexdigest()

    instance = MagicMock()
    resp = MagicMock()
    resp.status_code = 200
    resp.raise_for_status = MagicMock()
    instance.post.return_value = resp

    with patch("httpx.Client") as mock_cls:
        mock_cls.return_value.__enter__.return_value = instance
        mock_cls.return_value.__exit__.return_value = None

        post_qa_result(
            "http://example.com/hook",
            {**payload, "threshold": 75.0},
            timeout_sec=5.0,
            webhook_secret="secret",
        )

    kwargs = instance.post.call_args.kwargs
    assert kwargs["headers"]["X-QA-HMAC"] == expected
    assert kwargs["headers"]["Content-Type"] == "application/json"
    assert instance.post.call_count == 1


def test_post_qa_result_retries_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def flaky_post(*_a: object, **_k: object) -> object:
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("transient")
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        return resp

    instance = MagicMock()
    instance.post = flaky_post

    monkeypatch.setattr("r3mes_qa_worker.webhook.time.sleep", lambda _s: None)

    with patch("httpx.Client") as mock_cls:
        mock_cls.return_value.__enter__.return_value = instance
        mock_cls.return_value.__exit__.return_value = None

        post_qa_result(
            "http://example.com/hook",
            {"jobId": "j1", "threshold": 75.0},
            timeout_sec=5.0,
            webhook_secret="secret",
        )

    assert calls["n"] == 3
