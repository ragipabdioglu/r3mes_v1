"""llama-server üzerinden gerçek tamamlama — PyTorch yok."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def get_lora_adapters(base_url: str, *, timeout_sec: float = 30.0) -> list[dict[str, Any]]:
    """GET /lora-adapters — süreç başlarken --lora ile yüklenmiş adaptörler."""
    url = f"{base_url.rstrip('/')}/lora-adapters"
    with httpx.Client(timeout=timeout_sec) as client:
        r = client.get(url)
        r.raise_for_status()
        data = r.json()
    if not isinstance(data, list):
        raise ValueError("GET /lora-adapters bir JSON dizi dönmelidir")
    return data


def apply_lora_scales(
    base_url: str,
    scales: list[tuple[int, float]],
    *,
    timeout_sec: float = 120.0,
) -> None:
    """POST /lora-adapters — yalnızca id + scale (llama.cpp parse_lora_request ile uyumlu)."""
    url = f"{base_url.rstrip('/')}/lora-adapters"
    body: list[dict[str, Any]] = [{"id": i, "scale": s} for i, s in scales]
    with httpx.Client(timeout=timeout_sec) as client:
        r = client.post(url, json=body)
        r.raise_for_status()


def _post_lora_merged(
    base_url: str,
    adapters_snapshot: list[dict[str, Any]],
    slot_id: int,
    new_scale: float,
    *,
    timeout_sec: float = 120.0,
) -> None:
    """Tüm slotların scale değerini koru; yalnızca slot_id için new_scale uygula (tek öğeli POST diğerlerini 0'lar)."""
    body: list[dict[str, Any]] = []
    for a in adapters_snapshot:
        sid = int(a["id"])
        sc = float(new_scale) if sid == slot_id else float(a.get("scale", 0.0))
        body.append({"id": sid, "scale": sc})
    url = f"{base_url.rstrip('/')}/lora-adapters"
    with httpx.Client(timeout=timeout_sec) as client:
        r = client.post(url, json=body)
        r.raise_for_status()


def register_lora_adapter(
    base_url: str,
    downloaded_gguf: str | Path,
    *,
    slot_id: int = 0,
    scale: float = 1.0,
    copy_target_override: str | Path | None = None,
    timeout_sec: float = 600.0,
) -> None:
    """
    LoRA'yı llama-server ile hizala: adaptörler zaten --lora ile yüklüdür; HTTP ile yeni dosya
    kaydı yoktur (POST gövdesindeki path alanı sunucu tarafından okunmaz).

    Akış: GET /lora-adapters → indirilen GGUF'u sunucunun kullandığı dosya yoluna kopyala
    → POST /lora-adapters ile ölçek uygula.

    slot_id: İlk --lora için 0, ikinci için 1, … (sunucu listesindeki sıra).
    copy_target_override: Yazılacak dosya; yoksa GET'teki aynı slot'un path alanı kullanılır.
    """
    adapters = get_lora_adapters(base_url, timeout_sec=min(30.0, timeout_sec))
    if not adapters:
        raise RuntimeError(
            "llama-server üzerinde yüklü LoRA yok (GET /lora-adapters boş). "
            "Süreci en az bir adaptör ile başlatın: llama-server ... --lora <yol.gguf> "
            "(isteğe bağlı: --lora-init-without-apply). "
            "Worker IPFS'ten indirdiği GGUF'u bu dosyanın üzerine kopyalar, ardından POST ile scale uygular."
        )

    slot = _adapter_by_slot_id(adapters, slot_id)
    if copy_target_override is not None:
        target = Path(copy_target_override)
    else:
        raw_path = slot.get("path")
        if not raw_path:
            raise RuntimeError(f"LoRA slot id={slot_id} için path yok: {slot!r}")
        target = Path(str(raw_path))

    src = Path(downloaded_gguf)
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("LoRA GGUF kopyalanıyor: %s -> %s", src, target)
    shutil.copy2(src, target)

    _post_lora_merged(base_url, adapters, slot_id, scale, timeout_sec=timeout_sec)


def _adapter_by_slot_id(adapters: list[dict[str, Any]], slot_id: int) -> dict[str, Any]:
    for a in adapters:
        if int(a.get("id", -1)) == slot_id:
            return a
    raise RuntimeError(
        f"GET /lora-adapters içinde id={slot_id} yok; mevcut id'ler: "
        f"{[a.get('id') for a in adapters]}"
    )


def chat_completion_text(
    base_url: str,
    *,
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    max_tokens: int = 256,
    timeout_sec: float = 600.0,
) -> str:
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    payload: dict[str, Any] = {
        "messages": messages,
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if model:
        payload["model"] = model
    try:
        with httpx.Client(timeout=timeout_sec) as client:
            r = client.post(url, json=payload)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as e:
        logger.error(
            "POST /v1/chat/completions başarısız (base_url=%s): %s",
            base_url.rstrip("/"),
            e,
        )
        raise
    return str(data["choices"][0]["message"]["content"] or "")
