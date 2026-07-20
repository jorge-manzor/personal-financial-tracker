"""Unit tests del catálogo de bancos Chile (sin levantar FastAPI)."""

from __future__ import annotations

from banking_banks import bank_name_for_sbif, is_valid_bank_sbif, load_bancos_chile


def test_load_bancos_chile_nonempty() -> None:
    rows = load_bancos_chile()
    assert isinstance(rows, list)
    assert len(rows) >= 5
    assert "sbif" in rows[0] and "name" in rows[0]


def test_bank_lookup_known_and_unknown() -> None:
    assert is_valid_bank_sbif("001") is True
    assert bank_name_for_sbif("001")
    assert is_valid_bank_sbif("99999") is False
    assert bank_name_for_sbif("99999") is None
    assert bank_name_for_sbif(None) is None
    assert bank_name_for_sbif("") is None
