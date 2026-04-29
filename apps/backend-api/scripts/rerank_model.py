import json
import os
import sys
from typing import Any


def load_backend() -> tuple[Any, Any, Any]:
    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
    except Exception as exc:  # pragma: no cover - helper runtime path
        raise RuntimeError(
            "transformers and torch are required for model reranking. "
            "Point R3MES_RERANKER_PYTHON to a venv that has them installed."
        ) from exc

    model_name = os.environ.get("R3MES_RERANKER_MODEL", "BAAI/bge-reranker-base")
    device = os.environ.get("R3MES_RERANKER_DEVICE", "cpu").strip().lower() or "cpu"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    if device == "cuda" and torch.cuda.is_available():
        model = model.to("cuda")
        active_device = "cuda"
    else:
        active_device = "cpu"
    model.eval()
    return torch, tokenizer, model, active_device


def score_documents(torch: Any, tokenizer: Any, model: Any, device: str, query: str, documents: list[str]) -> list[float]:
    if not documents:
        return []
    max_length = int(os.environ.get("R3MES_RERANKER_MAX_LENGTH", "512"))
    query = str(query)
    documents = [str(document) for document in documents]
    merged_inputs = [f"Query: {query}\nDocument: {document}" for document in documents]
    batch = tokenizer(
        merged_inputs,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    if device == "cuda":
        batch = {key: value.to("cuda") for key, value in batch.items()}
    with torch.no_grad():
        logits = model(**batch).logits.view(-1).detach().cpu().tolist()
    return [float(item) for item in logits]


def main() -> int:
    try:
        torch, tokenizer, model, device = load_backend()
    except Exception as exc:
        print(f"failed to initialize reranker model: {exc}", file=sys.stderr, flush=True)
        return 1

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            request_id = str(payload["id"])
            query = str(payload["query"])
            documents = [str(item) for item in payload.get("documents", [])]
            scores = score_documents(torch, tokenizer, model, device, query, documents)
            response = {"id": request_id, "scores": scores}
        except Exception as exc:  # pragma: no cover - helper runtime path
            response = {"id": payload.get("id", "unknown") if isinstance(payload, dict) else "unknown", "error": str(exc)}
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
