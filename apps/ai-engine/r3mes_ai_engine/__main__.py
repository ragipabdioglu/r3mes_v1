"""python -m r3mes_ai_engine — uvicorn ile yerel sunucu."""

import os

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("R3MES_HOST", "127.0.0.1")
    port = int(os.environ.get("R3MES_PORT", "8000"))
    uvicorn.run("r3mes_ai_engine.app:app", host=host, port=port, reload=False)
