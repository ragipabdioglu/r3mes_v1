from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from r3mes_ai_engine.schemas_openai import ChatCompletionRequest
from r3mes_ai_engine.settings import Settings
from r3mes_ai_engine.state import AppState

logger = logging.getLogger(__name__)


@dataclass
class HfRuntime:
    model_name_or_path: str
    tokenizer: Any
    base_model: Any
    active_adapter_path: str | None = None
    active_model: Any | None = None


_hf_lock = asyncio.Lock()


def _lazy_imports() -> tuple[Any, Any, Any, Any]:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    return torch, PeftModel, AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig


def _resolve_model_name(settings: Settings) -> str:
    if settings.hf_model_local_path and settings.hf_model_local_path.exists():
        return str(settings.hf_model_local_path.resolve())
    return settings.hf_model_name_or_path


def _as_generation_messages(body: ChatCompletionRequest) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    if body.system_context:
        messages.append({"role": "system", "content": body.system_context})
    if body.retrieved_context:
        messages.append({"role": "system", "content": body.retrieved_context})
    for message in body.messages:
        if message.content is None:
            continue
        messages.append({"role": message.role, "content": message.content})
    return messages


def _resolve_input_device(model: Any) -> Any:
    try:
        return model.get_input_embeddings().weight.device
    except Exception:
        try:
            return next(model.parameters()).device
        except StopIteration:
            return "cpu"


async def _load_base_runtime(settings: Settings, state: AppState) -> HfRuntime:
    if state.hf_runtime is not None:
        return state.hf_runtime

    torch, _PeftModel, AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig = _lazy_imports()
    model_name_or_path = _resolve_model_name(settings)

    def _load() -> HfRuntime:
        settings.hf_offload_folder.mkdir(parents=True, exist_ok=True)
        tokenizer = AutoTokenizer.from_pretrained(
            model_name_or_path,
            trust_remote_code=True,
            local_files_only=settings.hf_local_files_only,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "left"

        quantization_config = None
        if settings.hf_load_in_4bit:
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.float16,
            )

        model = AutoModelForCausalLM.from_pretrained(
            model_name_or_path,
            trust_remote_code=True,
            quantization_config=quantization_config,
            device_map=settings.hf_device_map,
            low_cpu_mem_usage=settings.hf_low_cpu_mem_usage,
            local_files_only=settings.hf_local_files_only,
            offload_state_dict=True,
            offload_folder=str(settings.hf_offload_folder.resolve()),
        )
        model.eval()
        return HfRuntime(model_name_or_path=model_name_or_path, tokenizer=tokenizer, base_model=model)

    runtime = await asyncio.to_thread(_load)
    state.hf_runtime = runtime
    logger.info("hf_runtime hazır model=%s", runtime.model_name_or_path)
    return runtime


async def _resolve_active_model(
    settings: Settings,
    state: AppState,
    adapter_path: str | None,
) -> HfRuntime:
    async with _hf_lock:
        runtime = await _load_base_runtime(settings, state)
        if not adapter_path:
            runtime.active_adapter_path = None
            runtime.active_model = runtime.base_model
            return runtime

        candidate = Path(adapter_path)
        if not candidate.exists():
            raise HTTPException(status_code=400, detail={"code": "ADAPTER_PATH_NOT_FOUND", "message": "adapter_path bulunamadı"})
        if not (candidate / "adapter_model.safetensors").is_file():
            raise HTTPException(
                status_code=400,
                detail={"code": "ADAPTER_PATH_INVALID", "message": "adapter_path içinde adapter_model.safetensors yok"},
            )
        if runtime.active_adapter_path == str(candidate.resolve()) and runtime.active_model is not None:
            return runtime

        torch, PeftModel, _AutoModelForCausalLM, _AutoTokenizer, _BitsAndBytesConfig = _lazy_imports()

        def _attach() -> Any:
            model = PeftModel.from_pretrained(
                runtime.base_model,
                str(candidate.resolve()),
                device_map=settings.hf_device_map,
            )
            model.eval()
            return model

        runtime.active_model = await asyncio.to_thread(_attach)
        runtime.active_adapter_path = str(candidate.resolve())
        logger.info("hf_runtime adapter yüklendi path=%s", runtime.active_adapter_path)
        return runtime


def _build_openai_response(
    body: ChatCompletionRequest,
    content: str,
    *,
    request_id: str | None,
    model_name: str,
) -> JSONResponse:
    response = {
        "id": request_id or f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.model or model_name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }
    return JSONResponse(response)


def _streaming_response(
    body: ChatCompletionRequest,
    content: str,
    *,
    request_id: str | None,
    model_name: str,
) -> StreamingResponse:
    async def _events() -> AsyncIterator[bytes]:
        first = {
            "id": request_id or f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": body.model or model_name,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": content}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(first, ensure_ascii=False)}\n\n".encode("utf-8")
        final = {
            "id": first["id"],
            "object": "chat.completion.chunk",
            "created": first["created"],
            "model": first["model"],
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n".encode("utf-8")
        yield b"data: [DONE]\n\n"

    return StreamingResponse(_events(), media_type="text/event-stream")


async def hf_chat_completions(
    settings: Settings,
    state: AppState,
    body: ChatCompletionRequest,
    *,
    request_id: str | None = None,
) -> JSONResponse | StreamingResponse:
    runtime = await _resolve_active_model(settings, state, body.adapter_path)
    messages = _as_generation_messages(body)
    if not messages:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_MESSAGES", "message": "messages boş olamaz"})

    def _generate() -> str:
        torch, _PeftModel, _AutoModelForCausalLM, _AutoTokenizer, _BitsAndBytesConfig = _lazy_imports()
        rendered = runtime.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = runtime.tokenizer(rendered, return_tensors="pt")
        input_device = _resolve_input_device(runtime.active_model)
        inputs = {key: value.to(input_device) for key, value in inputs.items()}
        with torch.inference_mode():
            output = runtime.active_model.generate(
                **inputs,
                max_new_tokens=body.max_tokens or settings.hf_max_new_tokens_default,
                temperature=body.temperature,
                top_p=body.top_p,
                do_sample=(body.temperature or 0) >= 0.35,
                use_cache=True,
                eos_token_id=runtime.tokenizer.eos_token_id,
                pad_token_id=runtime.tokenizer.pad_token_id,
            )
        generated = output[0][inputs["input_ids"].shape[1] :]
        return runtime.tokenizer.decode(generated, skip_special_tokens=True).strip()

    content = await asyncio.to_thread(_generate)
    if body.stream:
        return _streaming_response(body, content, request_id=request_id, model_name=runtime.model_name_or_path)
    return _build_openai_response(body, content, request_id=request_id, model_name=runtime.model_name_or_path)
