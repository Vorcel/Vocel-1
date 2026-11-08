"""Testes offline das regras do Financeiro (sem banco/rede).
Rodar: backend/venv/Scripts/python.exe tests/financeiro_test.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("DB_NAME", "test")

from fastapi import HTTPException  # noqa: E402

from fin_core import (  # noqa: E402
    effective_status, occurrence_dates, signed_cents, split_installments, to_cents,
)


def test_to_cents():
    assert to_cents("1.234,56") == 123456
    assert to_cents("1234.56") == 123456
    assert to_cents(0.1 + 0.2) == 30          # float de entrada não vaza erro binário
    assert to_cents("R$ 1.000,00") == 100000
    assert to_cents(19.995) == 2000            # arredondamento comercial
    for bad in ("", None, "abc", "-5", "0"):
        try:
            to_cents(bad)
        except HTTPException:
            continue
        raise AssertionError(f"deveria rejeitar {bad!r}")
    assert signed_cents("-1.500,00") == -150000
    assert signed_cents("") == 0


def test_parcelado():
    assert split_installments(100000, 10) == [10000] * 10          # R$ 1.000 em 10x
    assert split_installments(100000, 3) == [33333, 33333, 33334]   # 333,33 + 333,33 + 333,34
    for total, n in ((1, 3), (999999, 7), (100001, 12)):
        parts = split_installments(total, n)
        assert sum(parts) == total and len(parts) == n


def test_datas():
    assert occurrence_dates("2026-01-31", 4, "mensal") == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]
    assert occurrence_dates("2026-11-07", 3, "semanal") == ["2026-11-07", "2026-11-14", "2026-11-21"]
    assert occurrence_dates("2026-12-15", 2, "bimestral") == ["2026-12-15", "2027-02-15"]
    assert len(occurrence_dates("2026-11-07", 10, "mensal")) == 10


def test_status_derivado():
    assert effective_status({"status": "pendente", "due_date": "2026-11-06"}, "2026-11-07") == "atrasado"
    assert effective_status({"status": "pendente", "due_date": "2026-11-07"}, "2026-11-07") == "pendente"
    assert effective_status({"status": "pago", "due_date": "2020-01-01"}, "2026-11-07") == "pago"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
