from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3


def _canonical_json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def post_qa_result(
    url: str,
    payload: dict[str, Any],
    *,
    timeout_sec: float,
    webhook_secret: str | None = None,
) -> None:
    body = _canonical_json_bytes(payload)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if webhook_secret:
        digest = hmac.new(webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        headers["X-QA-HMAC"] = digest

    last_exc: BaseException | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with httpx.Client(timeout=timeout_sec) as client:
                r = client.post(url, content=body, headers=headers)
                r.raise_for_status()
            return
        except Exception as e:
            last_exc = e
            logger.warning(
                "QA webhook POST denemesi %s/%s başarısız: %s",
                attempt + 1,
                _MAX_ATTEMPTS,
                e,
            )
            if attempt < _MAX_ATTEMPTS - 1:
                delay_sec = 2**attempt
                time.sleep(delay_sec)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("QA webhook: beklenmeyen durum")
