"""Catálogo de bancos Chile (SBIF) — datos estáticos en data/bancos_chile.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_BANKS_CHILE_PATH = Path(__file__).resolve().parent / "data" / "bancos_chile.json"


def load_bancos_chile() -> list[dict[str, Any]]:
    if not _BANKS_CHILE_PATH.is_file():
        return []
    raw = json.loads(_BANKS_CHILE_PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else []


def bank_name_for_sbif(sbif: str | None) -> str | None:
    if not sbif:
        return None
    s = str(sbif).strip()
    for row in load_bancos_chile():
        if str(row.get("sbif", "")).strip() == s:
            out = str(row.get("name", "")).strip()
            return out or None
    return None


def is_valid_bank_sbif(sbif: str) -> bool:
    return bank_name_for_sbif(sbif) is not None
