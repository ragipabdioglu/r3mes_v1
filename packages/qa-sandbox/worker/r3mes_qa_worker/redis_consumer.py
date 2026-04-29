from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

import redis

logger = logging.getLogger(__name__)


def ensure_stream_group(r: redis.Redis, stream: str, group: str) -> None:
    try:
        r.xgroup_create(stream, group, id="0", mkstream=True)
        logger.info("Redis stream grubu oluşturuldu: %s / %s", stream, group)
    except redis.exceptions.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise


def loop_list_queue(
    redis_url: str,
    list_key: str,
    handler: Callable[[dict[str, Any]], None],
    *,
    blpop_timeout_sec: int = 5,
) -> None:
    """Basit liste kuyruğu — LPUSH / BLPOP ile Fastify veya köprü servisi uyumu."""
    r = redis.Redis.from_url(redis_url, decode_responses=True)
    logger.info("BLPOP dinleniyor: %s", list_key)
    while True:
        item = r.blpop(list_key, timeout=blpop_timeout_sec)
        if not item:
            continue
        _key, payload = item
        _ = _key
        try:
            data = json.loads(payload)
            handler(data)
        except Exception:
            logger.exception("Liste job işlenemedi: %s", payload[:500])


def loop_stream_queue(
    redis_url: str,
    stream_key: str,
    group: str,
    consumer: str,
    handler: Callable[[dict[str, Any]], None],
    *,
    block_ms: int = 5000,
) -> None:
    """Redis Streams tüketicisi — XREADGROUP ile kalıcı teslimat."""
    r = redis.Redis.from_url(redis_url, decode_responses=True)
    ensure_stream_group(r, stream_key, group)
    logger.info("XREADGROUP dinleniyor: stream=%s group=%s", stream_key, group)
    while True:
        resp = r.xreadgroup(
            groupname=group,
            consumername=consumer,
            streams={stream_key: ">"},
            count=1,
            block=block_ms,
        )
        if not resp:
            continue
        for _sname, messages in resp:
            for msg_id, fields in messages:
                try:
                    raw = fields.get("data") or fields.get("payload") or fields.get("json")
                    if raw is None:
                        raw = json.dumps(fields)
                    data = json.loads(raw) if isinstance(raw, str) else raw
                    if not isinstance(data, dict):
                        raise ValueError("Stream alanı dict değil")
                    handler(data)
                    r.xack(stream_key, group, msg_id)
                except Exception:
                    logger.exception("Stream job işlenemedi id=%s", msg_id)
