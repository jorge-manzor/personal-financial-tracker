"""
Smoke tests HTTP: health, registro/login, banking e investments gated por servicio.

Usa SQLite temporal; no toca portfolio.db del desarrollador.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Debe ejecutarse antes de importar database/main.
_TMP = tempfile.mkdtemp(prefix="zendo-smoke-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'smoke.db'}"
os.environ["JWT_SECRET"] = "ci-smoke-test-secret-not-for-production"
os.environ.pop("RESET_BANKING_CATALOG_ON_STARTUP", None)

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


def test_health_and_auth_banking_investments_smoke() -> None:
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

        email = "smoke@example.com"
        password = "smoke-pass-123"

        reg = client.post("/auth/register", json={"email": email, "password": password})
        assert reg.status_code == 200, reg.text
        token = reg.json()["access_token"]
        assert token
        headers = {"Authorization": f"Bearer {token}"}

        me = client.get("/auth/me", headers=headers)
        assert me.status_code == 200
        body = me.json()
        assert body["email"] == email
        assert body["services"]["investments"] is False
        assert body["services"]["banking"] is False

        # Sin servicio banking → 403
        banks_denied = client.get("/banking/banks", headers=headers)
        assert banks_denied.status_code == 403

        # Activar banking
        patched = client.patch("/auth/me", headers=headers, json={"banking": True})
        assert patched.status_code == 200
        assert patched.json()["services"]["banking"] is True

        banks = client.get("/banking/banks", headers=headers)
        assert banks.status_code == 200
        assert isinstance(banks.json(), list)

        accounts = client.get("/banking/accounts", headers=headers)
        assert accounts.status_code == 200

        # Inversiones: sin servicio → 403
        hold_denied = client.get("/holdings", headers=headers)
        assert hold_denied.status_code == 403

        inv = client.patch("/auth/me", headers=headers, json={"investments": True})
        assert inv.status_code == 200
        assert inv.json()["services"]["investments"] is True

        holdings = client.get("/holdings", headers=headers)
        assert holdings.status_code == 200
        assert isinstance(holdings.json(), list)

        login = client.post("/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200
        assert login.json()["access_token"]
