"""
Smoke tests HTTP: health, auth, banking e investments (gates + CRUD mínimo).

Usa SQLite temporal; no toca portfolio.db del desarrollador.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

# Debe ejecutarse antes de importar database/main.
_TMP = tempfile.mkdtemp(prefix="zendo-smoke-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'smoke.db'}"
os.environ["JWT_SECRET"] = "ci-smoke-test-secret-not-for-production"
os.environ.pop("RESET_BANKING_CATALOG_ON_STARTUP", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _unique_email(prefix: str = "smoke") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


def _register(client: TestClient, *, email: str | None = None, password: str = "smoke-pass-123") -> tuple[str, str, dict[str, str]]:
    email = email or _unique_email()
    reg = client.post("/auth/register", json={"email": email, "password": password})
    assert reg.status_code == 200, reg.text
    token = reg.json()["access_token"]
    assert token
    return email, password, {"Authorization": f"Bearer {token}"}


def test_health_and_root(client: TestClient) -> None:
    for path in ("/health", "/"):
        r = client.get(path)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"


def test_auth_register_login_me_and_password(client: TestClient) -> None:
    email, password, headers = _register(client)

    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == email
    assert body["services"]["investments"] is False
    assert body["services"]["banking"] is False

    bad = client.post("/auth/login", json={"email": email, "password": "wrong-password"})
    assert bad.status_code == 401

    login = client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    assert login.json()["access_token"]

    dup = client.post("/auth/register", json={"email": email, "password": password})
    assert dup.status_code == 400

    new_password = "smoke-pass-456"
    ch = client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": password, "new_password": new_password},
    )
    assert ch.status_code == 200, ch.text

    old_login = client.post("/auth/login", json={"email": email, "password": password})
    assert old_login.status_code == 401
    new_login = client.post("/auth/login", json={"email": email, "password": new_password})
    assert new_login.status_code == 200


def test_unauthenticated_protected_routes(client: TestClient) -> None:
    assert client.get("/auth/me").status_code == 401
    assert client.get("/holdings").status_code == 401
    assert client.get("/banking/banks").status_code == 401


def test_banking_service_gate_and_crud(client: TestClient) -> None:
    _, _, headers = _register(client, email=_unique_email("bank"))

    assert client.get("/banking/banks", headers=headers).status_code == 403

    patched = client.patch("/auth/me", headers=headers, json={"banking": True})
    assert patched.status_code == 200
    assert patched.json()["services"]["banking"] is True

    banks = client.get("/banking/banks", headers=headers)
    assert banks.status_code == 200
    bank_list = banks.json()
    assert isinstance(bank_list, list)
    assert len(bank_list) >= 1
    sbif = str(bank_list[0]["sbif"])

    accounts = client.get("/banking/accounts", headers=headers)
    assert accounts.status_code == 200
    assert accounts.json() == []

    created = client.post(
        "/banking/accounts",
        headers=headers,
        json={
            "name": "Cuenta smoke",
            "initial_balance": 1000,
            "product_type": "cuenta_corriente",
            "bank_sbif": sbif,
            "enabled": True,
            "include_in_total_balance": True,
        },
    )
    assert created.status_code == 200, created.text
    acc = created.json()
    assert acc["name"] == "Cuenta smoke"
    assert float(acc["balance"]) == 1000.0

    debt = client.get("/banking/debt-totals", headers=headers)
    assert debt.status_code == 200
    assert isinstance(debt.json(), dict)

    cats = client.get("/banking/categories", headers=headers)
    assert cats.status_code == 200
    assert isinstance(cats.json(), list)

    txs = client.get("/banking/transactions", headers=headers)
    assert txs.status_code == 200
    tx_body = txs.json()
    assert "items" in tx_body
    assert isinstance(tx_body["items"], list)

    bad_bank = client.post(
        "/banking/accounts",
        headers=headers,
        json={
            "name": "Bad bank",
            "initial_balance": 0,
            "product_type": "cuenta_corriente",
            "bank_sbif": "99999",
            "enabled": True,
        },
    )
    assert bad_bank.status_code == 400


def test_investments_service_gate_and_reads(client: TestClient) -> None:
    _, _, headers = _register(client, email=_unique_email("inv"))

    assert client.get("/holdings", headers=headers).status_code == 403
    assert client.get("/portfolio", headers=headers).status_code == 403
    assert client.get("/dashboard-initial", headers=headers).status_code == 403

    inv = client.patch("/auth/me", headers=headers, json={"investments": True})
    assert inv.status_code == 200
    assert inv.json()["services"]["investments"] is True

    for path in ("/holdings", "/portfolio", "/dashboard-initial", "/sync-status", "/transactions"):
        r = client.get(path, headers=headers)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
