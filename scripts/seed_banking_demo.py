#!/usr/bin/env python3
"""Genera movimientos bancarios de prueba vía la API para iterar la UI rápido.

Uso:
    python scripts/seed_banking_demo.py
    python scripts/seed_banking_demo.py --count 80 --email ui-demo@zendo.local --password DemoPass123!

Requiere el backend corriendo (por defecto http://127.0.0.1:8000). Si el usuario
no existe lo registra, activa el servicio banking, crea una cuenta corriente y
una tarjeta de crédito si no tiene ninguna, y carga N movimientos aleatorios
mezclando ingresos, gastos personales, gastos compartidos y cargos de tarjeta.
"""

from __future__ import annotations

import argparse
import json
import random
import urllib.error
import urllib.request
from datetime import date, timedelta

DESCRIPTIONS = [
    # (categoria, subcategoria, texto, monto_min, monto_max, en_tarjeta)
    ("Remuneracion", "Sueldo", "Sueldo", 900000, 1600000, False),
    ("Remuneracion", "Bono", "Bono", 50000, 300000, False),
    ("Vivienda", "Arriendo", "Arriendo", 250000, 450000, False),
    ("Servicios Basicos", "Electricidad", "Cuenta luz", 15000, 45000, False),
    ("Servicios Basicos", "Internet", "Internet hogar", 18000, 25000, False),
    ("Alimentacion", "Supermercado", "Supermercado Jumbo", 15000, 90000, False),
    ("Alimentacion", "Supermercado", "Supermercado Lider", 12000, 70000, False),
    ("Alimentacion", "Restaurante", "Restaurante", 8000, 35000, True),
    ("Alimentacion", "Delivery / Pedidos online", "Pedidos Rappi", 6000, 22000, True),
    ("Alimentacion", "Cafeteria", "Cafeteria", 2500, 6500, True),
    ("Transporte", "Bencina", "Bencina Copec", 20000, 60000, False),
    ("Transporte", "Taxi / Uber / Cabify", "Uber", 3500, 15000, True),
    ("Transporte", "Transporte publico", "Metro / Bip", 800, 3000, False),
    ("Tecnologia", "Equipos (celular, computador, etc.)", "Compra tienda tech", 30000, 250000, True),
    ("Tecnologia", "Software y aplicaciones", "Suscripcion software", 5000, 20000, True),
    ("Suscripciones", "Streaming video", "Netflix", 8990, 8990, False),
    ("Suscripciones", "Streaming musica", "Spotify Premium", 5990, 15990, True),
    ("Entretenimiento", "Salidas y eventos", "Salida fin de semana", 10000, 40000, True),
    ("Ropa y Cuidado Personal", "Ropa y calzado", "Ropa", 15000, 80000, True),
    ("Salud", "Farmacia / Medicamentos", "Farmacia", 5000, 30000, False),
]

SHARED_POOL = [
    ("Alimentacion", "Restaurante", "Cena con amigos", 15000, 60000),
    ("Entretenimiento", "Salidas y eventos", "Salida grupal", 10000, 45000),
    ("Transporte", "Taxi / Uber / Cabify", "Uber compartido", 4000, 12000),
]


def http_json(url: str, method: str = "GET", body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} -> {e.code}: {e.read().decode()}") from e


def get_or_create_token(base: str, email: str, password: str) -> str:
    try:
        out = http_json(f"{base}/auth/login", "POST", {"email": email, "password": password})
    except RuntimeError:
        out = http_json(f"{base}/auth/register", "POST", {"email": email, "password": password})
    return out["access_token"]


def ensure_banking(base: str, token: str) -> None:
    me = http_json(f"{base}/auth/me", "GET", token=token)
    if not me["services"].get("banking"):
        http_json(f"{base}/auth/me", "PATCH", {"banking": True}, token=token)


def ensure_accounts(base: str, token: str) -> tuple[int, int]:
    accounts = http_json(f"{base}/banking/accounts", "GET", token=token)
    checking = next((a for a in accounts if a["product_type"] == "cuenta_corriente"), None)
    if checking is None:
        checking = http_json(
            f"{base}/banking/accounts",
            "POST",
            {
                "name": "Cuenta Corriente",
                "initial_balance": 800000,
                "product_type": "cuenta_corriente",
                "bank_sbif": "001",
                "enabled": True,
                "include_in_total_balance": True,
            },
            token=token,
        )
    card = next((a for a in accounts if a["product_type"] == "tarjeta_credito"), None)
    if card is None:
        card = http_json(
            f"{base}/banking/accounts",
            "POST",
            {
                "name": "Tarjeta Visa",
                "initial_balance": 0,
                "product_type": "tarjeta_credito",
                "bank_sbif": checking["bank_sbif"],
                "linked_checking_account_id": checking["id"],
                "enabled": True,
                "include_in_total_balance": True,
            },
            token=token,
        )
    return checking["id"], card["id"]


def build_category_lookup(base: str, token: str) -> dict[tuple[str, str], tuple[int, int]]:
    categories = http_json(f"{base}/banking/categories", "GET", token=token)
    lookup: dict[tuple[str, str], tuple[int, int]] = {}
    for cat in categories:
        for sub in cat["subcategories"]:
            lookup[(cat["name"], sub["name"])] = (cat["id"], sub["id"])
    return lookup


def random_date(months_back: int) -> date:
    today = date.today()
    start = today - timedelta(days=30 * months_back)
    delta_days = (today - start).days
    return start + timedelta(days=random.randint(0, delta_days))


def build_transaction(
    checking_id: int, card_id: int, months_back: int, lookup: dict[tuple[str, str], tuple[int, int]]
) -> dict | None:
    if random.random() < 0.12:
        pool = [row for row in SHARED_POOL if (row[0], row[1]) in lookup]
        if not pool:
            return None
        cat_name, sub_name, desc, lo, hi = random.choice(pool)
        cat_id, sub_id = lookup[(cat_name, sub_name)]
        amount = -random.randint(lo, hi)
        return {
            "account_id": checking_id,
            "fecha": random_date(months_back).isoformat(),
            "amount": amount,
            "description": desc,
            "category_id": cat_id,
            "subcategory_id": sub_id,
            "is_shared": True,
            "split_participants": random.choice([2, 3, 4]),
        }

    pool = [row for row in DESCRIPTIONS if (row[0], row[1]) in lookup]
    if not pool:
        return None
    cat_name, sub_name, desc, lo, hi, can_be_card = random.choice(pool)
    cat_id, sub_id = lookup[(cat_name, sub_name)]
    is_income = cat_name == "Remuneracion"
    amount = random.randint(lo, hi)
    if not is_income:
        amount = -amount
    account_id = card_id if (can_be_card and random.random() < 0.4) else checking_id
    return {
        "account_id": account_id,
        "fecha": random_date(months_back).isoformat(),
        "amount": amount,
        "description": desc,
        "category_id": cat_id,
        "subcategory_id": sub_id,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--email", default="ui-demo@zendo.local")
    parser.add_argument("--password", default="DemoPass123!")
    parser.add_argument("--count", type=int, default=60)
    parser.add_argument("--months-back", type=int, default=4)
    args = parser.parse_args()

    token = get_or_create_token(args.base, args.email, args.password)
    ensure_banking(args.base, token)
    checking_id, card_id = ensure_accounts(args.base, token)
    lookup = build_category_lookup(args.base, token)

    ok = 0
    skipped = 0
    for _ in range(args.count):
        tx = build_transaction(checking_id, card_id, args.months_back, lookup)
        if tx is None:
            skipped += 1
            continue
        try:
            http_json(f"{args.base}/banking/transactions", "POST", tx, token=token)
            ok += 1
        except RuntimeError as e:
            print(f"  ! fallo: {e}")

    if skipped:
        print(f"  (omitidos {skipped}: categorias del pool no encontradas en tu catalogo)")

    print(f"Listo: {ok}/{args.count} movimientos creados para {args.email}")
    print(f"Cuenta corriente id={checking_id}  Tarjeta id={card_id}")


if __name__ == "__main__":
    main()
