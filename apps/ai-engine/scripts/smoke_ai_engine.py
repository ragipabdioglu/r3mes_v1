#!/usr/bin/env python3
"""
Canlı ai-engine smoke — release öncesi kontrol ve (isteğe bağlı) çıkarım kanıtı.

Örnek:
  set R3MES_SMOKE_ADAPTER_CID=bafy...
  python scripts/smoke_ai_engine.py
  python scripts/smoke_ai_engine.py --prove-inference
  python scripts/smoke_ai_engine.py --json

--prove-inference: aynı CID ile ardışık iki istek; gerçek yanıt gövdesi + ideal olarak cache miss→hit.

Ortam: R3MES_SMOKE_BASE_URL, R3MES_SMOKE_ADAPTER_CID, ...

Çıkış: 0 OK | 1 health | 2 CID yok | 3 chat HTTP hatası | 4 kanıt başarısız (200 ama completion boş/uyumsuz) | 5 --prove-inference ile concurrent>1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

TRIAGE_HINT: dict[str, str] = {
    "adapter_download": "IPFS gateway, ağ veya CID; R3MES_IPFS_GATEWAY / firewall",
    "lora_hot_swap": "llama-server POST .../lora-adapters (yanıt veya erişim)",
    "upstream_completion": "llama-server POST .../v1/chat/completions",
    "llama_process": "llama-server süreci; R3MES_SKIP_LLAMA=false ve süreç ayakta mı",
}


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v else default


def _get_json(url: str, timeout: float = 10.0) -> Any:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _post_json(
    url: str,
    body: dict[str, Any],
    *,
    timeout: float = 120.0,
    request_id: str | None = None,
) -> tuple[int, dict[str, str], bytes]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if request_id:
        headers["X-Request-ID"] = request_id
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, hdrs, resp.read()
    except urllib.error.HTTPError as e:
        hdrs = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        return e.code, hdrs, e.read()


def _detail_triage(raw: bytes) -> tuple[dict[str, Any] | None, str | None]:
    """FastAPI detail sözlüğü ve kısa teşhis ipucu."""
    try:
        err = json.loads(raw.decode())
    except json.JSONDecodeError:
        return None, None
    detail = err.get("detail")
    if not isinstance(detail, dict):
        return None, None
    stage = detail.get("stage")
    hint = TRIAGE_HINT.get(str(stage), "ai-engine loglarında stage/category/cause")
    return {k: detail.get(k) for k in ("stage", "category", "cause", "retryable", "adapter_cid")}, hint


def verify_openai_completion_body(raw: bytes) -> tuple[bool, str]:
    """
    Non-stream chat.completion gövdesinde anlamlı bir asistan çıktısı var mı.

    Dönüş: (ok, önizleme veya hata kodu)
    """
    try:
        obj = json.loads(raw.decode())
    except json.JSONDecodeError:
        return False, "invalid_json"
    if not isinstance(obj, dict):
        return False, "not_object"
    choices = obj.get("choices")
    if not isinstance(choices, list) or len(choices) == 0:
        return False, "no_choices"
    c0 = choices[0]
    if not isinstance(c0, dict):
        return False, "bad_choice"
    msg = c0.get("message")
    content: str | None = None
    if isinstance(msg, dict):
        c = msg.get("content")
        if isinstance(c, str):
            content = c
    if content is None and isinstance(c0.get("text"), str):
        content = c0["text"]
    if not content or not str(content).strip():
        return False, "empty_content"
    preview = str(content).strip()[:200]
    return True, preview


def _cache_pattern(a: str | None, b: str | None) -> str:
    if a == "miss" and b == "hit":
        return "miss_then_hit"
    if a == "hit" and b == "hit":
        return "hit_hit"
    if a == "miss" and b == "miss":
        return "miss_miss"
    return f"{a!s}_{b!s}"


def main() -> int:
    parser = argparse.ArgumentParser(description="R3MES ai-engine release smoke")
    parser.add_argument(
        "--base-url",
        default=_env("R3MES_SMOKE_BASE_URL", "http://127.0.0.1:8000"),
        help="ai-engine taban URL",
    )
    parser.add_argument(
        "--adapter-cid",
        default=_env("R3MES_SMOKE_ADAPTER_CID"),
        help="LoRA GGUF IPFS CID",
    )
    parser.add_argument(
        "--concurrent",
        type=int,
        default=int(_env("R3MES_SMOKE_CONCURRENT", "1") or "1"),
        help="aynı non-stream isteğini kaç iş parçacığında gönder",
    )
    parser.add_argument(
        "--health-only",
        action="store_true",
        help="yalnızca GET /health (CID gerekmez)",
    )
    parser.add_argument(
        "--prove-inference",
        action="store_true",
        help="ardışık 2 istek: tamamlama gövdesi doğrula + cache başlıkları (cold: miss→hit)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="son satıra tek satır JSON özet (CI / karar desteği)",
    )
    parser.add_argument(
        "--request-id",
        default=_env("R3MES_SMOKE_REQUEST_ID"),
        help="X-Request-ID (log ile eşleştirme)",
    )
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    out: dict[str, Any] = {"base_url": base}

    print("smoke: health", base)
    try:
        h = _get_json(f"{base}/health")
    except Exception as e:
        print("FAIL: health", e, file=sys.stderr)
        out.update({"ok": False, "health_ok": False, "error": str(e)})
        _emit_json(args.json, out)
        return 1
    if h.get("status") != "ok":
        print("FAIL: health body", h, file=sys.stderr)
        out.update({"ok": False, "health_ok": False, "health_body": h})
        _emit_json(args.json, out)
        return 1
    print("OK: health")
    out["health_ok"] = True

    if args.health_only:
        out["ok"] = True
        _emit_json(args.json, out)
        return 0

    cid = args.adapter_cid
    if not cid:
        print("SKIP: adapter CID yok; chat atlandı (R3MES_SMOKE_ADAPTER_CID veya --adapter-cid)", file=sys.stderr)
        out.update({"ok": False, "skipped": "no_adapter_cid"})
        _emit_json(args.json, out)
        return 2

    body = {
        "messages": [{"role": "user", "content": "Say only: smoke-ok"}],
        "adapter_cid": cid,
        "stream": False,
        "max_tokens": 64,
    }
    url = f"{base}/v1/chat/completions"
    rid = args.request_id

    def one_request(_i: int) -> tuple[int, float, dict[str, str], bytes]:
        t0 = time.monotonic()
        code, hdrs, raw = _post_json(url, body, request_id=rid)
        dt = (time.monotonic() - t0) * 1000.0
        return code, dt, hdrs, raw

    n = max(1, args.concurrent)

    if args.prove_inference and n != 1:
        print("FAIL: --prove-inference sadece --concurrent 1 ile kullanılır", file=sys.stderr)
        return 5

    if args.prove_inference:
        print(f"smoke: LIVE PROOF (2 sequential) adapter_cid={cid[:16]}...")
        rounds: list[dict[str, Any]] = []
        for round_idx in (1, 2):
            code, dt, hdrs, raw = one_request(0)
            cache = hdrs.get("x-r3mes-adapter-cache", "?")
            print(f"  round {round_idx} status={code} cache={cache} duration_ms={dt:.1f}")
            ok_body, preview_or_err = verify_openai_completion_body(raw) if code == 200 else (False, "http_error")
            if code == 200:
                for key in (
                    "x-r3mes-adapter-cache",
                    "x-r3mes-lock-wait-ms",
                    "x-r3mes-adapter-resolve-ms",
                ):
                    if key in hdrs:
                        print(f"    {key}: {hdrs[key]}")
            if code != 200:
                triage, hint = _detail_triage(raw)
                _print_error_detail(raw, hint)
                out.update(
                    {
                        "ok": False,
                        "live_proof": {"failed_at_round": round_idx, "chat_status": code, "triage": triage},
                    }
                )
                _emit_json(args.json, out)
                return 3
            if not ok_body:
                print(f"FAIL: completion gövdesi kanıtlanamadı ({preview_or_err})", file=sys.stderr)
                out.update(
                    {
                        "ok": False,
                        "live_proof": {"failed_at_round": round_idx, "reason": preview_or_err},
                    }
                )
                _emit_json(args.json, out)
                return 4
            print(f"    assistant_preview: {preview_or_err[:120]!r}")
            rounds.append(
                {
                    "round": round_idx,
                    "cache": cache,
                    "duration_ms": round(dt, 2),
                    "assistant_preview": preview_or_err[:200],
                }
            )
        c1 = rounds[0].get("cache")
        c2 = rounds[1].get("cache")
        pattern = _cache_pattern(str(c1) if c1 != "?" else None, str(c2) if c2 != "?" else None)
        out["ok"] = True
        out["live_proof"] = {
            "completion_verified": True,
            "rounds": rounds,
            "cache_pattern": pattern,
        }
        print(f"LIVE_PROOF_OK: cache_pattern={pattern} (ideal cold: miss_then_hit)")
        _emit_json(args.json, out)
        return 0

    print(f"smoke: POST chat/completions (non-stream) x{n} adapter_cid={cid[:16]}...")

    if n == 1:
        code, dt, hdrs, raw = one_request(0)
        print(f"  status={code} duration_ms={dt:.1f}")
        triage, hint = _detail_triage(raw)
        _print_response_info(code, hdrs, raw, hint)
        ok_c, prev = verify_openai_completion_body(raw) if code == 200 else (False, "")
        out.update(
            {
                "ok": code == 200,
                "chat_status": code,
                "duration_ms": round(dt, 2),
                "triage": triage,
                "triage_hint": hint,
                "completion_verified": ok_c if code == 200 else None,
                "assistant_preview": prev[:120] if ok_c else None,
            }
        )
        if code == 200 and hdrs:
            out["diagnostic_headers"] = {
                k: hdrs[k]
                for k in (
                    "x-r3mes-adapter-cache",
                    "x-r3mes-lock-wait-ms",
                    "x-r3mes-adapter-resolve-ms",
                    "x-r3mes-lora-swap-ms",
                    "x-r3mes-lora-slot",
                )
                if k in hdrs
            }
        _emit_json(args.json, out)
        if code == 200:
            return 0
        return 3

    lock_waits: list[float] = []
    codes: list[int] = []
    durations: list[float] = []
    with ThreadPoolExecutor(max_workers=n) as ex:
        futs = [ex.submit(one_request, i) for i in range(n)]
        for fut in as_completed(futs):
            code, dt, hdrs, raw = fut.result()
            codes.append(code)
            durations.append(dt)
            lw = hdrs.get("x-r3mes-lock-wait-ms")
            if lw:
                try:
                    lock_waits.append(float(lw))
                except ValueError:
                    pass
            triage, _ = _detail_triage(raw)
            stage = triage.get("stage") if triage else "-"
            print(f"  status={code} duration_ms={dt:.1f} lock_wait_ms={lw or '-'} stage={stage}")
    ok_all = all(c == 200 for c in codes)
    lock_observed = (
        len(lock_waits) >= 2 and max(lock_waits) > 0 and min(lock_waits) < max(lock_waits)
    )
    out.update(
        {
            "ok": ok_all,
            "concurrent": n,
            "chat_statuses": codes,
            "duration_ms": {"min": round(min(durations), 2), "max": round(max(durations), 2)},
            "lock_wait_ms": {"min": min(lock_waits), "max": max(lock_waits)} if lock_waits else None,
            "lock_serialization_observed": lock_observed,
        }
    )
    if lock_observed:
        print("OK: eşzamanlı isteklerde lock bekleme farkı (global lock beklenen davranış)")
    elif ok_all and n > 1:
        print("NOT: lock farkı görülmedi (tek worker veya çok hızlı tamamlanma; tekrar deneyin)")

    _emit_json(args.json, out)
    if not ok_all:
        return 3
    return 0


def _emit_json(enabled: bool, payload: dict[str, Any]) -> None:
    if enabled:
        print("JSON_SUMMARY:", json.dumps(payload, ensure_ascii=False), flush=True)


def _print_error_detail(raw: bytes, hint: str | None) -> None:
    try:
        err = json.loads(raw.decode())
    except json.JSONDecodeError:
        print("  body:", raw[:500], file=sys.stderr)
        return
    detail = err.get("detail")
    if isinstance(detail, dict):
        core = {k: detail.get(k) for k in ("stage", "category", "cause", "retryable", "adapter_cid")}
        print("  detail:", core)
        if hint:
            print("  next_check:", hint)
    else:
        print("  detail:", detail, file=sys.stderr)


def _print_response_info(
    code: int,
    hdrs: dict[str, str],
    raw: bytes,
    hint: str | None,
) -> None:
    if code == 200:
        for key in (
            "x-r3mes-adapter-cache",
            "x-r3mes-lock-wait-ms",
            "x-r3mes-adapter-resolve-ms",
            "x-r3mes-lora-swap-ms",
            "x-r3mes-lora-slot",
        ):
            if key in hdrs:
                print(f"  {key}: {hdrs[key]}")
        ok, prev = verify_openai_completion_body(raw)
        if ok:
            print(f"  assistant_preview: {prev[:120]!r}")
        else:
            print(f"  WARN: completion şekli beklenenden farklı ({prev})", file=sys.stderr)
        return
    _print_error_detail(raw, hint)


if __name__ == "__main__":
    raise SystemExit(main())
