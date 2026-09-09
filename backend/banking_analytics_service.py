"""
Agregaciones de solo lectura para la sección Analítica de Banking (Release 1).

No crea ni modifica movimientos: solo lee `BankingTransaction` y agrega por mes/categoría.
Excluye del "gasto"/"ingreso" real dos tipos de movimiento que no son flujo real del usuario:

- Transferencia entre cuentas propias (categoría plantilla 19, subcategoría plantilla 1901).
  La subcategoría hermana "Envío a terceros" (1902) SÍ es gasto real y no se excluye.
- Pago de tarjeta de crédito (categoría plantilla interna 20): es el espejo en cuenta corriente
  del pago del total facturado; el gasto real ya quedó contado en el cargo original de la TC.
  Excluirlo evita contar el mismo gasto dos veces.

El agrupamiento por mes usa `accounting_month` (mes contable) cuando está seteado, igual que
`banking_filter_transactions_through_current_accounting_month` en `banking_service.py`; si es
None, se usa el mes calendario de `fecha` (equivalente, porque accounting_month siempre se guarda
como el primer día del mes).
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from banking_service import (
    TEMPLATE_CAT_PAGO_TARJETA_CREDITO,
    TEMPLATE_CAT_TRANSFERENCIA,
    TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS,
    resolved_category_color,
)
from models import BankingAccount, BankingCategory, BankingSubcategory, BankingTransaction

MESES_LARGO = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]
MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def parse_month_key(value: str) -> tuple[int, int]:
    try:
        y_s, m_s = value.split("-")
        year, month = int(y_s), int(m_s)
    except (ValueError, AttributeError) as exc:
        raise ValueError("Formato de mes inválido, usa YYYY-MM.") from exc
    if not (1 <= month <= 12):
        raise ValueError("Formato de mes inválido, usa YYYY-MM.")
    return year, month


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    return start, end


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _accounting_month_filter(start: date, end: date):
    """Movimientos cuyo mes contable (accounting_month o, si es None, el mes de fecha) cae en [start, end]."""
    return or_(
        and_(
            BankingTransaction.accounting_month.is_(None),
            BankingTransaction.fecha >= start,
            BankingTransaction.fecha <= end,
        ),
        and_(
            BankingTransaction.accounting_month.isnot(None),
            BankingTransaction.accounting_month >= start,
            BankingTransaction.accounting_month <= end,
        ),
    )


def _real_movement_filter():
    """Excluye transferencias entre cuentas propias y pagos de tarjeta de crédito (no son gasto/ingreso real)."""
    return and_(
        ~and_(
            BankingCategory.template_cat_id == TEMPLATE_CAT_TRANSFERENCIA,
            BankingSubcategory.template_sub_id == TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS,
        ),
        or_(
            BankingCategory.template_cat_id.is_(None),
            BankingCategory.template_cat_id != TEMPLATE_CAT_PAGO_TARJETA_CREDITO,
        ),
    )


def _real_rows_for_range(db: Session, user_id: int, start: date, end: date) -> list[tuple[BankingTransaction, BankingCategory]]:
    """Movimientos "reales" (ya excluidos traspasos propios y pagos de TC) de cuentas incluidas en el saldo."""
    rows = (
        db.query(BankingTransaction, BankingCategory)
        .join(BankingCategory, BankingCategory.id == BankingTransaction.category_id)
        .join(BankingSubcategory, BankingSubcategory.id == BankingTransaction.subcategory_id)
        .join(BankingAccount, BankingAccount.id == BankingTransaction.account_id)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingAccount.user_id == user_id,
            BankingAccount.include_in_total_balance.is_(True),
            _accounting_month_filter(start, end),
            _real_movement_filter(),
        )
        .all()
    )
    return rows


def _category_egresos_for_month(db: Session, user_id: int, year: int, month: int) -> dict[int, dict[str, Any]]:
    start, end = _month_bounds(year, month)
    rows = _real_rows_for_range(db, user_id, start, end)
    by_cat: dict[int, dict[str, Any]] = {}
    for tx, cat in rows:
        if tx.amount >= 0:
            continue
        entry = by_cat.setdefault(
            cat.id,
            {"nombre": cat.name, "color": resolved_category_color(cat), "monto": 0.0},
        )
        entry["monto"] += -float(tx.amount)
    return by_cat


def _totals_for_month(db: Session, user_id: int, year: int, month: int) -> tuple[float, float]:
    start, end = _month_bounds(year, month)
    rows = _real_rows_for_range(db, user_id, start, end)
    ingresos = sum(float(tx.amount) for tx, _ in rows if tx.amount > 0)
    egresos = sum(-float(tx.amount) for tx, _ in rows if tx.amount < 0)
    return ingresos, egresos


def _first_movement_month(db: Session, user_id: int) -> tuple[int, int] | None:
    """Primer mes con algún movimiento del usuario (en cuentas incluidas en el saldo), por `fecha`."""
    first = (
        db.query(BankingTransaction.fecha)
        .join(BankingAccount, BankingAccount.id == BankingTransaction.account_id)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingAccount.user_id == user_id,
            BankingAccount.include_in_total_balance.is_(True),
        )
        .order_by(BankingTransaction.fecha.asc())
        .limit(1)
        .scalar()
    )
    if first is None:
        return None
    return first.year, first.month


def category_summary(db: Session, user_id: int, year: int, month: int) -> dict[str, Any]:
    """US-01 + US-02 + parte de US-04: distribución de gasto, top 5 con variación, e ingresos/egresos del mes."""
    ingresos, egresos = _totals_for_month(db, user_id, year, month)
    by_cat = _category_egresos_for_month(db, user_id, year, month)

    py, pm = _shift_month(year, month, -1)
    ingresos_prev, egresos_prev = _totals_for_month(db, user_id, py, pm)
    by_cat_prev = _category_egresos_for_month(db, user_id, py, pm)
    tiene_historial_previo = bool(by_cat_prev) or egresos_prev > 0 or ingresos_prev > 0

    total_egresos = egresos
    segments = []
    for cat_id, data in sorted(by_cat.items(), key=lambda kv: kv[1]["monto"], reverse=True):
        pct = (data["monto"] / total_egresos * 100.0) if total_egresos > 0 else 0.0
        segments.append(
            {
                "category_id": cat_id,
                "nombre": data["nombre"],
                "monto": round(data["monto"], 2),
                "pct": round(pct, 1),
                "color": data["color"],
            }
        )

    top_categorias = []
    for rank, seg in enumerate(segments[:5], start=1):
        prev_monto = by_cat_prev.get(seg["category_id"], {}).get("monto")
        if not tiene_historial_previo:
            variacion_pct = None
            es_nueva = False
        elif prev_monto is None or prev_monto == 0:
            variacion_pct = None
            es_nueva = True
        else:
            variacion_pct = round((seg["monto"] - prev_monto) / prev_monto * 100.0, 1)
            es_nueva = False
        top_categorias.append(
            {
                "rank": rank,
                "category_id": seg["category_id"],
                "nombre": seg["nombre"],
                "monto": seg["monto"],
                "color": seg["color"],
                "variacion_pct": variacion_pct,
                "es_nueva": es_nueva,
            }
        )

    balance_neto = ingresos - egresos
    ingresos_var_pct = (
        round((ingresos - ingresos_prev) / ingresos_prev * 100.0, 1) if ingresos_prev > 0 else None
    )
    egresos_var_pct = (
        round((egresos - egresos_prev) / egresos_prev * 100.0, 1) if egresos_prev > 0 else None
    )

    return {
        "month": month_key(year, month),
        "empty": ingresos == 0 and egresos == 0,
        "total_ingresos": round(ingresos, 2),
        "total_egresos": round(egresos, 2),
        "balance_neto": round(balance_neto, 2),
        "ingresos_var_pct": ingresos_var_pct,
        "egresos_var_pct": egresos_var_pct,
        "segments": segments,
        "top_categorias": top_categorias,
        "tiene_historial_previo": tiene_historial_previo,
    }


def monthly_trend(db: Session, user_id: int, year: int, month: int, meses: int) -> dict[str, Any]:
    """US-03 + derivados de US-04/§8: serie ingresos/egresos + promedios + mejor mes."""
    first = _first_movement_month(db, user_id)

    candidate_months: list[tuple[int, int]] = []
    y, m = year, month
    for _ in range(meses):
        candidate_months.append((y, m))
        y, m = _shift_month(y, m, -1)
    candidate_months.reverse()

    if first is None:
        candidate_months = []
    else:
        candidate_months = [ym for ym in candidate_months if ym >= first]

    puntos = []
    for y2, m2 in candidate_months:
        ingresos, egresos = _totals_for_month(db, user_id, y2, m2)
        puntos.append(
            {
                "month": month_key(y2, m2),
                "label": f"{MESES_CORTO[m2 - 1]} {y2}",
                "ingresos": round(ingresos, 2),
                "egresos": round(egresos, 2),
            }
        )

    if not puntos:
        return {
            "empty": True,
            "meses": [],
            "ingreso_promedio": 0.0,
            "egreso_promedio": 0.0,
            "ahorro_promedio": 0.0,
            "mejor_mes": None,
        }

    n = len(puntos)
    suma_ing = sum(p["ingresos"] for p in puntos)
    suma_egr = sum(p["egresos"] for p in puntos)

    best_idx = 0
    best_balance = puntos[0]["ingresos"] - puntos[0]["egresos"]
    for i, p in enumerate(puntos):
        bal = p["ingresos"] - p["egresos"]
        if bal > best_balance:
            best_balance = bal
            best_idx = i

    return {
        "empty": False,
        "meses": puntos,
        "ingreso_promedio": round(suma_ing / n, 2),
        "egreso_promedio": round(suma_egr / n, 2),
        "ahorro_promedio": round((suma_ing - suma_egr) / n, 2),
        "mejor_mes": puntos[best_idx]["label"],
    }
