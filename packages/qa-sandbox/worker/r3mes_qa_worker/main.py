from __future__ import annotations

import logging
import sys

from r3mes_qa_worker.job_runner import run_benchmark_job
from r3mes_qa_worker.redis_consumer import loop_list_queue, loop_stream_queue
from r3mes_qa_worker.settings import Settings, get_settings

_LOG_FMT = "%(asctime)s %(levelname)s %(name)s — %(message)s"
logger = logging.getLogger("r3mes_qa_worker")


def _configure_logging(settings: Settings) -> None:
    fmt = logging.Formatter(_LOG_FMT)
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    out = logging.StreamHandler(sys.stdout)
    out.setFormatter(fmt)
    root.addHandler(out)
    if settings.qa_worker_log_file is not None:
        p = settings.qa_worker_log_file
        p.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(p, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)


def _handle_job(raw: dict, settings: Settings) -> None:
    run_benchmark_job(raw, settings)


def main() -> None:
    settings = get_settings()
    if not settings.qa_webhook_secret:
        logging.basicConfig(level=logging.INFO, format=_LOG_FMT)
        logging.getLogger("r3mes_qa_worker").warning(
            "R3MES_QA_WEBHOOK_SECRET tanımsız veya boş; QA webhook HMAC olmadan worker çalıştırılamaz. Çıkılıyor."
        )
        sys.exit(1)
    _configure_logging(settings)
    if settings.qa_worker_log_file is not None:
        logger.info("Kalıcı log dosyası: %s", settings.qa_worker_log_file)
    logger.info(
        "QA worker başlıyor (mode=%s, redis=%s, baraj=%.1f)",
        settings.queue_mode,
        settings.redis_url,
        settings.score_threshold,
    )

    def handler(raw: dict) -> None:
        try:
            _handle_job(raw, settings)
        except Exception:
            logger.exception("Benchmark job işlenemedi")

    if settings.queue_mode == "streams":
        loop_stream_queue(
            settings.redis_url,
            settings.stream_key,
            settings.consumer_group,
            settings.consumer_name,
            handler,
        )
    else:
        loop_list_queue(
            settings.redis_url,
            settings.list_queue_key,
            handler,
            blpop_timeout_sec=settings.blpop_timeout_sec,
        )


if __name__ == "__main__":
    main()
