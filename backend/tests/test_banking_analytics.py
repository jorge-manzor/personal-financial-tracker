"""
Smoke tests HTTP de Analítica Banking (Release 1): agregación por categoría, top 5,
evolución mensual y — lo más importante — exclusión de transferencias entre cuentas
propias y de pagos de tarjeta de crédito del cálculo de "gasto real" (ver
docs/spec-analitica-banking-release-1.md, riesgo abierto de US-01/US-02).

Reutiliza el patrón de test_smoke.py: SQLite temporal, TestClient del app real.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from datetime import date
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="zendo-analytics-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'analytics.db'}"
os.environ["JWT_SECRET"] = "ci-analytics-test-secret-not-for-production"
os.environ.pop("RESET_BANKING_CATALOG_ON_STARTUP", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _unique_email(prefix: str = "analytics") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


def _register_banking_user(client: TestClient) -> dict[str, str]:
    email = _unique_email()
    reg = client.post("/auth/register", json={"email": email, "password": "smoke-pass-123"})
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    patched = client.patch("/auth/me", headers=headers, json={"banking": True})
    assert patched.status_code == 200
    return headers


def _create_account(client: TestClient, headers: dict[str, str], *, name: str, product_type: str, sbif: str, linked_checking_account_id: int | None = None) -> dict:
    body = {
        "name": name,
        "initial_balance": 0,
        "product_type": product_type,
        "bank_sbif": sbif,
        "enabled": True,
        "include_in_total_balance": True,
    }
    if linked_checking_account_id is not None:
        body["linked_checking_account_id"] = linked_checking_account_id
    r = client.post("/banking/accounts", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


# Categorías plantilla internas/especiales que nunca deben usarse como "gasto normal" en los tests
# (ver banking_service.TEMPLATE_CAT_TRANSFERENCIA / TEMPLATE_CAT_PAGO_TARJETA_CREDITO).
_NON_REGULAR_TEMPLATE_CAT_IDS = {19, 20}


def _find_category(cats: list[dict], *, template_cat_id: int | None = None, not_internal: bool = False) -> dict:
    for c in cats:
        if template_cat_id is not None and c.get("template_cat_id") == template_cat_id:
            return c
        if (
            not_internal
            and not c.get("internal_reserved")
            and c.get("template_cat_id") not in _NON_REGULAR_TEMPLATE_CAT_IDS
            and c.get("subcategories")
        ):
            return c
    raise AssertionError(f"Categoría no encontrada (template_cat_id={template_cat_id}, not_internal={not_internal})")


def test_analytics_empty_state_for_new_banking_user(client: TestClient) -> None:
    headers = _register_banking_user(client)
    today = date.today()
    month = f"{today.year:04d}-{today.month:02d}"

    summary = client.get(f"/banking/analytics/category-summary?month={month}", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["empty"] is True
    assert body["segments"] == []
    assert body["top_categorias"] == []
    assert body["total_ingresos"] == 0
    assert body["total_egresos"] == 0

    trend = client.get(f"/banking/analytics/monthly-trend?month={month}&meses=6", headers=headers)
    assert trend.status_code == 200, trend.text
    tbody = trend.json()
    assert tbody["empty"] is True
    assert tbody["meses"] == []
    assert tbody["mejor_mes"] is None


def test_analytics_excludes_internal_transfer_and_cc_payment(client: TestClient) -> None:
    headers = _register_banking_user(client)

    banks = client.get("/banking/banks", headers=headers)
    sbif = str(banks.json()[0]["sbif"])

    checking = _create_account(client, headers, name="Corriente", product_type="cuenta_corriente", sbif=sbif)
    cash = _create_account(client, headers, name="Efectivo", product_type="cuenta_prepago", sbif=sbif)
    credit_card = _create_account(
        client,
        headers,
        name="Tarjeta",
        product_type="tarjeta_credito",
        sbif=sbif,
        linked_checking_account_id=checking["id"],
    )

    cats = client.get("/banking/categories", headers=headers).json()
    transferencia = _find_category(cats, template_cat_id=19)
    entre_cuentas_propias = next(s for s in transferencia["subcategories"] if s.get("template_sub_id") == 1901)
    gasto_cat = _find_category(cats, not_internal=True)
    gasto_sub = gasto_cat["subcategories"][0]

    today = date.today()
    month = f"{today.year:04d}-{today.month:02d}"
    fecha = today.isoformat()

    # Ingreso real.
    r = client.post(
        "/banking/transactions",
        headers=headers,
        json={
            "account_id": checking["id"],
            "fecha": fecha,
            "amount": 500000,
            "category_id": gasto_cat["id"],
            "subcategory_id": gasto_sub["id"],
        },
    )
    assert r.status_code == 200, r.text

    # Egreso real (cuenta corriente).
    r = client.post(
        "/banking/transactions",
        headers=headers,
        json={
            "account_id": checking["id"],
            "fecha": fecha,
            "amount": -100000,
            "category_id": gasto_cat["id"],
            "subcategory_id": gasto_sub["id"],
        },
    )
    assert r.status_code == 200, r.text

    # Transferencia entre cuentas propias (checking -> cash): NO debe contarse ni como ingreso ni como egreso.
    r = client.post(
        "/banking/transactions",
        headers=headers,
        json={
            "account_id": checking["id"],
            "fecha": fecha,
            "amount": -50000,
            "category_id": transferencia["id"],
            "subcategory_id": entre_cuentas_propias["id"],
            "transfer_destination_account_id": cash["id"],
        },
    )
    assert r.status_code == 200, r.text

    # Cargo real en tarjeta de crédito (SÍ es gasto real).
    r = client.post(
        "/banking/transactions",
        headers=headers,
        json={
            "account_id": credit_card["id"],
            "fecha": fecha,
            "amount": -30000,
            "category_id": gasto_cat["id"],
            "subcategory_id": gasto_sub["id"],
            "credit_card_charge_paid": False,
        },
    )
    assert r.status_code == 200, r.text
    cc_charge_id = r.json()["id"]

    # Marcar el cargo TC como pagado: genera el espejo "Pago Tarjeta de Credito" en la cuenta corriente,
    # que NO debe sumarse como gasto adicional (ya se contó el cargo original arriba).
    r = client.patch(
        f"/banking/transactions/{cc_charge_id}",
        headers=headers,
        json={"credit_card_charge_paid": True},
    )
    assert r.status_code == 200, r.text

    summary = client.get(f"/banking/analytics/category-summary?month={month}", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()

    assert body["empty"] is False
    assert body["total_ingresos"] == pytest.approx(500000.0)
    # 100000 (egreso normal) + 30000 (cargo TC) — sin la transferencia (50000) ni el pago TC espejo (30000).
    assert body["total_egresos"] == pytest.approx(130000.0)
    assert body["balance_neto"] == pytest.approx(370000.0)

    assert len(body["segments"]) == 1
    assert body["segments"][0]["monto"] == pytest.approx(130000.0)
    assert body["segments"][0]["category_id"] == gasto_cat["id"]

    assert len(body["top_categorias"]) == 1
    assert body["top_categorias"][0]["monto"] == pytest.approx(130000.0)

    trend = client.get(f"/banking/analytics/monthly-trend?month={month}&meses=6", headers=headers)
    assert trend.status_code == 200, trend.text
    tbody = trend.json()
    assert tbody["empty"] is False
    assert len(tbody["meses"]) >= 1
    last = tbody["meses"][-1]
    assert last["ingresos"] == pytest.approx(500000.0)
    assert last["egresos"] == pytest.approx(130000.0)
    assert tbody["mejor_mes"] is not None
