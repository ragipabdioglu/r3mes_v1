from __future__ import annotations

import pytest

from r3mes_qa_worker.settings import Settings


def test_main_exits_when_qa_webhook_secret_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    bogus = Settings(qa_webhook_secret=None)
    monkeypatch.setattr("r3mes_qa_worker.main.get_settings", lambda: bogus)

    with pytest.raises(SystemExit) as exc:
        from r3mes_qa_worker.main import main

        main()
    assert exc.value.code == 1
