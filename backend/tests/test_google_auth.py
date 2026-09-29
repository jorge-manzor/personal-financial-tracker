"""
Login con Google (Épica A) — foco en US-01: vinculación automática por email para un usuario
EXISTENTE con historial real (transacciones de inversión + movimientos bancarios), sin pérdida
de datos ni duplicados. La verificación real del id_token (firma/JWKS de Google) se mockea aquí;
eso ya lo cubre `google-auth` internamente — lo que este archivo prueba es la lógica de matching.

Usa SQLite temporal; no toca portfolio.db del desarrollador.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import date, datetime
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="zendo-google-auth-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'google_auth.db'}"
os.environ["JWT_SECRET"] = "ci-google-auth-test-secret-not-for-production"
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com"
os.environ.pop("RESET_BANKING_CATALOG_ON_STARTUP", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import auth_routes  # noqa: E402
from database import SessionLocal  # noqa: E402
from main import app  # noqa: E402
from models import BankingAccount, BankingCategory, BankingSubcategory, BankingTransaction, Transaction, User  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _unique_email(prefix: str = "gauth") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


def _fake_google_claims(*, sub: str, email: str, email_verified: bool = True) -> dict:
    return {"sub": sub, "email": email, "email_verified": email_verified}


def _mock_google(monkeypatch: pytest.MonkeyPatch, claims: dict) -> None:
    """`auth_routes` importó `verify_google_id_token` por nombre; hay que parchear ahí, no en `auth`."""

    def fake_verify(_token: str) -> dict:
        return claims

    monkeypatch.setattr(auth_routes, "verify_google_id_token", fake_verify)


def _seed_real_history(email: str, password: str, client: TestClient) -> tuple[int, dict[str, str]]:
    """
    Cuenta con password + historial real: transacción de inversión, cuenta bancaria con
    movimiento, y ambos servicios (banking/investments) activos — igual que un usuario real.
    """
    reg = client.post("/auth/register", json={"email": email, "password": password})
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    user_id = client.get("/auth/me", headers=headers).json()["id"]

    patched = client.patch("/auth/me", headers=headers, json={"investments": True, "banking": True})
    assert patched.status_code == 200

    db = SessionLocal()
    try:
        # "Acciones" es exclusivo de sync Fintual; una transacción manual real usa Fondos/AFP.
        db.add(
            Transaction(
                user_id=user_id,
                fecha=date(2024, 1, 15),
                tipo="deposito",
                activo="Fondo Balanceado",
                acciones=1,
                precio_unitario=1500.0,
                monto_total=1500.0,
                categoria="Fondos",
                currency="CLP",
                source="manual",
            )
        )
        cat = BankingCategory(user_id=user_id, name="Vivienda", sort_order=0)
        db.add(cat)
        db.flush()
        sub = BankingSubcategory(user_id=user_id, category_id=cat.id, name="Arriendo", sort_order=0)
        db.add(sub)
        db.flush()
        acc = BankingAccount(
            user_id=user_id,
            name="Cuenta real",
            currency="CLP",
            product_type="cuenta_corriente",
            opening_balance=500_000,
            balance=500_000,
            created_at=datetime(2024, 1, 1),
        )
        db.add(acc)
        db.flush()
        db.add(
            BankingTransaction(
                user_id=user_id,
                account_id=acc.id,
                fecha=date(2024, 1, 5),
                amount=-450_000,
                description="Arriendo enero",
                category_id=cat.id,
                subcategory_id=sub.id,
                created_at=datetime(2024, 1, 5),
            )
        )
        db.commit()
    finally:
        db.close()

    return user_id, headers


def test_google_login_links_existing_account_without_losing_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """US-01 (crítica): usuario existente con historial real + Google mismo email -> mismo user_id, cero pérdida, cero duplicados."""
    email = _unique_email("existing")
    password = "existing-pass-123"
    user_id, password_headers = _seed_real_history(email, password, client)

    users_before = SessionLocal()
    try:
        assert users_before.query(User).filter(User.email == email).count() == 1
    finally:
        users_before.close()

    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-existing-1", email=email))
    r = client.post("/auth/google", json={"credential": "irrelevant-mocked"})
    assert r.status_code == 200, r.text
    google_token = r.json()["access_token"]
    google_headers = {"Authorization": f"Bearer {google_token}"}

    me_google = client.get("/auth/me", headers=google_headers).json()
    assert me_google["id"] == user_id, "debe ser la MISMA cuenta, no una nueva"
    assert me_google["google_linked"] is True
    assert me_google["services"]["investments"] is True
    assert me_google["services"]["banking"] is True

    # No se duplicó la cuenta.
    users_after = SessionLocal()
    try:
        assert users_after.query(User).filter(User.email == email).count() == 1
        assert users_after.query(Transaction).filter(Transaction.user_id == user_id).count() == 1
        assert users_after.query(BankingTransaction).filter(BankingTransaction.user_id == user_id).count() == 1
    finally:
        users_after.close()

    # El historial sigue accesible vía API bajo la sesión de Google.
    tx_inv = client.get("/transactions", headers=google_headers)
    assert tx_inv.status_code == 200
    assert tx_inv.json()["total"] == 1

    tx_bank = client.get("/banking/transactions", headers=google_headers, params={"full_history": True})
    assert tx_bank.status_code == 200
    assert len(tx_bank.json()["items"]) == 1

    # Password original sigue funcionando (coexistencia).
    old_login = client.post("/auth/login", json={"email": email, "password": password})
    assert old_login.status_code == 200
    assert client.get("/auth/me", headers=password_headers).json()["id"] == user_id


def test_google_login_case_insensitive_email_match(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    email = _unique_email("mixedcase")
    _, _ = _seed_real_history(email, "pass-123456", client)

    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-case-1", email=email.upper()))
    r = client.post("/auth/google", json={"credential": "x"})
    assert r.status_code == 200, r.text

    users = SessionLocal()
    try:
        assert users.query(User).filter(User.email == email.lower()).count() == 1
    finally:
        users.close()


def test_google_login_creates_new_user_when_email_unknown(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    email = _unique_email("brandnew")
    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-new-1", email=email))
    r = client.post("/auth/google", json={"credential": "x"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = client.get("/auth/me", headers=headers).json()
    assert me["email"] == email
    assert me["google_linked"] is True


def test_google_login_rejects_unverified_email(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    email = _unique_email("unverified")
    _seed_real_history(email, "pass-123456", client)
    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-unverified-1", email=email, email_verified=False))

    # `verify_google_id_token` real ya rechaza esto; acá simulamos que el mock respeta el contrato
    # devolviendo el HTTPException tal como lo haría la función real.
    from fastapi import HTTPException

    def fake_verify_rejects(_token: str) -> dict:
        raise HTTPException(status_code=401, detail="Email de Google no verificado")

    monkeypatch.setattr(auth_routes, "verify_google_id_token", fake_verify_rejects)
    r = client.post("/auth/google", json={"credential": "x"})
    assert r.status_code == 401

    users = SessionLocal()
    try:
        assert users.query(User).filter(User.email == email).count() == 1
    finally:
        users.close()


def test_google_login_repeated_returns_same_account(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """US-03: login recurrente ya vinculado -> misma cuenta, sin pasos adicionales."""
    email = _unique_email("recurrent")
    user_id, _ = _seed_real_history(email, "pass-123456", client)
    claims = _fake_google_claims(sub="google-sub-recurrent-1", email=email)
    _mock_google(monkeypatch, claims)

    first = client.post("/auth/google", json={"credential": "x"})
    assert first.status_code == 200
    second = client.post("/auth/google", json={"credential": "x"})
    assert second.status_code == 200

    for token in (first.json()["access_token"], second.json()["access_token"]):
        me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        assert me["id"] == user_id

    users = SessionLocal()
    try:
        assert users.query(User).filter(User.google_id == claims["sub"]).count() == 1
    finally:
        users.close()


def test_google_login_rejects_relinking_to_different_email_account(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Edge case spec: cuenta ya vinculada a un google_id no se puede pisar con otro distinto."""
    email = _unique_email("linked")
    _seed_real_history(email, "pass-123456", client)
    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-original", email=email))
    ok = client.post("/auth/google", json={"credential": "x"})
    assert ok.status_code == 200

    _mock_google(monkeypatch, _fake_google_claims(sub="google-sub-DIFFERENT", email=email))
    conflict = client.post("/auth/google", json={"credential": "x"})
    assert conflict.status_code == 409
