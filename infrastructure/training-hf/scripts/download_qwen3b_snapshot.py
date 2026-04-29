from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


DEFAULT_REPO_ID = "Qwen/Qwen2.5-3B-Instruct"
DEFAULT_LOCAL_DIR = Path(os.environ.get("R3MES_HF_MODEL_CACHE", r"C:\r3mes-hf-model-cache")) / "Qwen2.5-3B-Instruct"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID)
    parser.add_argument("--local-dir", default=str(DEFAULT_LOCAL_DIR))
    parser.add_argument("--token", default=os.environ.get("HF_TOKEN"))
    args = parser.parse_args()

    local_dir = Path(args.local_dir)
    local_dir.mkdir(parents=True, exist_ok=True)

    snapshot_path = snapshot_download(
        repo_id=args.repo_id,
        local_dir=str(local_dir),
        local_dir_use_symlinks=False,
        token=args.token,
        resume_download=True,
    )

    summary = {
        "repo_id": args.repo_id,
        "local_dir": str(local_dir),
        "snapshot_path": snapshot_path,
        "authenticated": bool(args.token),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
