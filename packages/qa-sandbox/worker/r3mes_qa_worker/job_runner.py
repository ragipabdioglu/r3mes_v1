from __future__ import annotations

import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from r3mes_qa_worker.dataset import load_hidden_rows
from r3mes_qa_worker.ipfs_download import download_ipfs_artifact
from r3mes_qa_worker.llama_client import chat_completion_text, register_lora_adapter
from r3mes_qa_worker.metrics import SampleScores, aggregate_quality_0_100, score_single
from r3mes_qa_worker.settings import Settings
from r3mes_qa_worker.webhook import post_qa_result

logger = logging.getLogger(__name__)


class BenchmarkJobPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    job_id: str = Field(..., alias="jobId")
    adapter_cid: str | None = Field(default=None, alias="adapterCid")
    ipfs_cid: str | None = Field(default=None, alias="ipfsCid")
    adapter_db_id: str | None = Field(default=None, alias="adapterDbId")

    @model_validator(mode="before")
    @classmethod
    def _coerce_from_bullmq(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if not d.get("jobId") and d.get("id") is not None:
            d["jobId"] = str(d["id"])
        cid = d.get("ipfsCid") or d.get("ipfs_cid") or d.get("adapterCid") or d.get("adapter_cid")
        if cid:
            if not d.get("ipfsCid"):
                d["ipfsCid"] = cid
            if not d.get("adapterCid"):
                d["adapterCid"] = cid
        return d

    @model_validator(mode="after")
    def _require_cid(self) -> BenchmarkJobPayload:
        if not (self.ipfs_cid or self.adapter_cid):
            raise ValueError("ipfsCid veya adapterCid gerekli")
        return self


def resolve_cid(payload: BenchmarkJobPayload) -> str:
    raw = payload.ipfs_cid or payload.adapter_cid
    if not raw:
        raise ValueError("ipfsCid veya adapterCid gerekli")
    return raw.strip()


def run_benchmark_job(raw: dict[str, Any], settings: Settings) -> dict[str, Any]:
    payload = BenchmarkJobPayload.model_validate(raw)
    cid = resolve_cid(payload)
    rows = load_hidden_rows(settings.hidden_dataset_path)

    with tempfile.TemporaryDirectory(prefix="r3mes-qa-") as tmp:
        dest = Path(tmp) / f"{cid.replace('/', '_')}.gguf"
        try:
            nbytes = download_ipfs_artifact(
                settings.ipfs_gateway,
                cid,
                dest,
                connect_timeout_sec=settings.ipfs_download_connect_timeout_sec,
                read_timeout_sec=settings.ipfs_download_read_timeout_sec,
            )
        except Exception as e:
            logger.error(
                "IPFS indirme başarısız (job=%s cid=%s gateway=%s): %s",
                payload.job_id,
                cid,
                settings.ipfs_gateway,
                e,
                exc_info=True,
            )
            out = _webhook_payload(
                payload.job_id,
                cid,
                adapter_db_id=payload.adapter_db_id,
                status="rejected",
                score=0.0,
                error=f"ipfs_download_failed: {e}",
                metrics={
                    "bytes": 0,
                    "samples": 0,
                    "qa_outcome": "failed",
                    "failure_stage": "ipfs_download",
                },
            )
            _safe_webhook(settings, out)
            return out

        try:
            register_lora_adapter(
                settings.qa_llama_base_url,
                dest,
                slot_id=settings.lora_slot_id,
                scale=settings.lora_scale,
                copy_target_override=settings.qa_lora_copy_target,
            )
        except Exception as e:
            logger.error(
                "LoRA kaydı başarısız (job=%s llama=%s slot=%s): %s",
                payload.job_id,
                settings.qa_llama_base_url,
                settings.lora_slot_id,
                e,
                exc_info=True,
            )
            out = _webhook_payload(
                payload.job_id,
                cid,
                adapter_db_id=payload.adapter_db_id,
                status="rejected",
                score=0.0,
                error=f"lora_register_failed: {e}",
                metrics={
                    "bytes": nbytes,
                    "samples": 0,
                    "qa_outcome": "failed",
                    "failure_stage": "lora_register",
                },
            )
            _safe_webhook(settings, out)
            return out

        sample_scores: list[SampleScores] = []
        try:
            for row in rows:
                ref = str(row.get("reference", ""))
                pr = str(row.get("prompt", ""))
                hyp = chat_completion_text(
                    settings.qa_llama_base_url,
                    messages=[{"role": "user", "content": pr}],
                    model=settings.qa_model_name,
                    temperature=0.2,
                )
                sample_scores.append(score_single(ref, hyp))
        except Exception as e:
            logger.error(
                "llama-server tamamlama başarısız (job=%s llama=%s): %s",
                payload.job_id,
                settings.qa_llama_base_url,
                e,
                exc_info=True,
            )
            out = _webhook_payload(
                payload.job_id,
                cid,
                adapter_db_id=payload.adapter_db_id,
                status="rejected",
                score=0.0,
                error=f"llama_inference_failed: {e}",
                metrics={
                    "bytes": nbytes,
                    "samples": len(sample_scores),
                    "qa_outcome": "failed",
                    "failure_stage": "llama_inference",
                },
            )
            _safe_webhook(settings, out)
            return out

    quality = aggregate_quality_0_100(sample_scores)
    approved = quality >= settings.score_threshold
    status = "approved" if approved else "rejected"

    metrics = {
        "adapter_bytes": nbytes,
        "samples": len(sample_scores),
        "rouge_l_f1_mean": sum(s.rouge_l_f1 for s in sample_scores) / max(1, len(sample_scores)),
        "bleu_mean": sum(s.bleu_0_1 for s in sample_scores) / max(1, len(sample_scores)),
        "per_sample": [
            {"rouge_l_f1": s.rouge_l_f1, "bleu_0_1": s.bleu_0_1} for s in sample_scores
        ],
    }

    out = _webhook_payload(
        payload.job_id,
        cid,
        adapter_db_id=payload.adapter_db_id,
        status=status,
        score=round(quality, 4),
        error=None,
        metrics=metrics,
    )
    _safe_webhook(settings, out)
    logger.info("Job %s → %s (score=%.2f)", payload.job_id, status, quality)
    return out


def _webhook_payload(
    job_id: str,
    adapter_cid: str,
    *,
    adapter_db_id: str | None,
    status: str,
    score: float,
    error: str | None,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    return {
        "jobId": job_id,
        "adapterCid": adapter_cid,
        "adapterDbId": adapter_db_id,
        "status": status,
        "score": score,
        "threshold": None,
        "error": error,
        "metrics": metrics,
        "requestId": str(uuid.uuid4()),
    }


def _safe_webhook(settings: Settings, payload: dict[str, Any]) -> None:
    body = {**payload, "threshold": settings.score_threshold}
    try:
        post_qa_result(
            settings.backend_qa_webhook_url,
            body,
            timeout_sec=settings.webhook_timeout_sec,
            webhook_secret=settings.qa_webhook_secret,
        )
    except Exception:
        logger.exception("QA webhook çağrısı tüm denemelerden sonra başarısız")
