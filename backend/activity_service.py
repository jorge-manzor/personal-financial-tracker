from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time
from typing import Any, Literal

from sqlalchemy.orm import Session

from exchange_service import get_rate_for_date
from history import transaction_occurred_at
from models import Transaction, WalletMovement


def _convert_amount(monto: float, cur: str, target: Literal["USD", "CLP"], db: Session, on: date) -> float:
    cur = (cur or "USD").upper()
    rate = get_rate_for_date(db, on)
    if target == "USD":
        return monto / rate if cur == "CLP" else monto
    return monto * rate if cur == "USD" else monto


def _map_wallet_tipo(event_type: str) -> str:
    return {
        "DIVIDEND": "dividendo",
        "DEPOSIT": "deposito",
        "WITHDRAWAL": "retiro",
        "CASH_INTEREST": "interes_caja",
        "COMPENSATION": "compensacion",
        "CASH_MERGER": "fusion_caja",
        "DIVESTMENT": "desinversion",
        "ACAT_CASH_INBOUND": "acat_ingreso",
        "ACAT_CASH_FEE": "acat_comision",
        "ACAT_CASH_OUTBOUND": "acat_egreso",
        "WARRANT_FEE": "warrant_comision",
        "WARRANT_COST": "warrant_costo",
    }.get(event_type, event_type.lower())


def _fintual_stock_row(t: Transaction) -> dict[str, Any]:
    src = getattr(t, "source", None) or "fintual"
    return {
        "id": t.id,
        "fecha": t.fecha,
        "tipo": t.tipo,
        "activo": t.activo,
        "acciones": float(t.acciones),
        "precio_unitario": float(t.precio_unitario),
        "monto_total": float(t.monto_total),
        "categoria": t.categoria,
        "currency": t.currency,
        "nombre_activo": t.nombre_activo,
        "occurred_at": t.occurred_at,
        "wallet_event_type": None,
        "amount_clp": None,
        "exchange_rate": None,
        "_src": "fintual",
        "source": src,
        "_sort_at": transaction_occurred_at(t),
    }


def _wallet_to_row(w: WalletMovement) -> dict[str, Any]:
    oc = w.occurred_at
    if isinstance(oc, datetime) and oc.tzinfo is not None:
        oc = oc.replace(tzinfo=None)
    sort_at = oc if isinstance(oc, datetime) else datetime.combine(date.today(), time(12, 0, 0))
    fd = oc.date() if isinstance(oc, datetime) else oc
    sym = (w.symbol or "-").upper().strip()
    monto = float(w.amount_usd) if w.amount_usd is not None else 0.0
    tipo = _map_wallet_tipo(w.event_type)
    label = f"Fintual · {w.event_type}"
    if w.symbol:
        label = f"{w.event_type} {sym}"
    return {
        "id": 10_000_000 + w.id,
        "fecha": fd,
        "tipo": tipo,
        "activo": sym if w.symbol else "WALLET",
        "acciones": 0.0,
        "precio_unitario": 0.0,
        "monto_total": monto,
        "categoria": "Acciones" if w.symbol else "Wallet USD",
        "currency": "USD",
        "nombre_activo": label,
        "occurred_at": sort_at,
        "wallet_event_type": w.event_type,
        "amount_clp": float(w.amount_clp) if w.amount_clp is not None else None,
        "exchange_rate": float(w.exchange_rate) if w.exchange_rate is not None else None,
        "_src": "fintual",
        "source": "wallet",
        "_sort_at": sort_at,
    }


def _manual_to_row(t: Transaction) -> dict[str, Any]:
    src = getattr(t, "source", None) or "manual"
    return {
        "id": t.id,
        "fecha": t.fecha,
        "tipo": t.tipo,
        "activo": t.activo,
        "acciones": float(t.acciones),
        "precio_unitario": float(t.precio_unitario),
        "monto_total": float(t.monto_total),
        "categoria": t.categoria,
        "currency": t.currency,
        "nombre_activo": t.nombre_activo,
        "occurred_at": t.occurred_at,
        "wallet_event_type": None,
        "amount_clp": None,
        "exchange_rate": None,
        "_src": "manual",
        "source": src,
        "_sort_at": transaction_occurred_at(t),
    }


_WALLET_INGRESO_TYPES = frozenset(
    {
        "DEPOSIT",
        "DIVIDEND",
        "CASH_INTEREST",
        "COMPENSATION",
        "CASH_MERGER",
        "DIVESTMENT",
        "ACAT_CASH_INBOUND",
    },
)

_WALLET_EGRESO_TYPES = frozenset(
    {"WITHDRAWAL", "ACAT_CASH_FEE", "ACAT_CASH_OUTBOUND", "WARRANT_FEE", "WARRANT_COST"},
)


def _wallet_flow_amount(w: WalletMovement, target: Literal["USD", "CLP"], db: Session, on: date) -> float:
    """Monto del movimiento de billetera en la moneda objetivo del gráfico."""
    if w.amount_usd is not None and abs(float(w.amount_usd)) > 1e-12:
        return _convert_amount(float(w.amount_usd), "USD", target, db, on)
    if w.amount_clp is not None:
        return _convert_amount(float(w.amount_clp), "CLP", target, db, on)
    return 0.0


def monthly_movements(
    db: Session,
    user_id: int,
    currency: Literal["USD", "CLP", "all"],
    scope: Literal["wallet", "stocks", "all", "fondos"] = "stocks",
) -> list[dict]:
    """
    Resumen mensual. `scope` elige qué sumar en ingresos/egresos de las barras:

    - **wallet:** solo movimientos de billetera (depósitos, dividendos en wallet, retiros…).
    - **stocks:** solo acciones US — **ingresos = compras** (incl. reinversiones) y **egresos = ventas**.
    - **all:** flujo de caja consolidado (solo efectivo):
      ``ingresos = wallet_ingresos + acciones_ventas`` (entradas),
      ``egresos = wallet_egresos + acciones_compras`` (salidas).
    - **fondos:** depósitos y retiros en CLP de fondos/metas Fintual (siempre CLP; `currency` se ignora).
      No mezcla doble contabilidad con la lista de transacciones: compras/ventas solo vienen de
      ``Transaction``; la billetera solo de ``WalletMovement``.

    Los campos `wallet_*`, `acciones_*` y `fondos_*` llevan el desglose para el cliente.
    """
    target: Literal["USD", "CLP"] = "USD" if currency == "all" else currency

    def empty_breakdown() -> dict[str, float]:
        return {
            "wallet_ingresos": 0.0,
            "wallet_egresos": 0.0,
            "acciones_compras": 0.0,
            "acciones_ventas": 0.0,
            "fondos_depositos": 0.0,
            "fondos_retiros": 0.0,
        }

    buckets: dict[tuple[int, int], dict[str, float]] = defaultdict(empty_breakdown)

    for w in (
        db.query(WalletMovement)
        .filter(WalletMovement.user_id == user_id)
        .order_by(WalletMovement.occurred_at)
        .all()
    ):
        oc = w.occurred_at
        if isinstance(oc, datetime) and oc.tzinfo is not None:
            oc = oc.replace(tzinfo=None)
        fd = oc.date() if isinstance(oc, datetime) else oc
        key = (fd.year, fd.month)
        raw = _wallet_flow_amount(w, target, db, fd)
        # Magnitud siempre positiva en el bucket correcto (ingreso vs egreso ya va por event_type).
        amt = abs(float(raw))
        et = (w.event_type or "").upper()
        if et in _WALLET_EGRESO_TYPES:
            buckets[key]["wallet_egresos"] += amt
        elif et in _WALLET_INGRESO_TYPES:
            buckets[key]["wallet_ingresos"] += amt

    for tx in (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.source == "fintual",
            Transaction.categoria == "Acciones",
            Transaction.tipo.in_(["compra", "reinversion", "venta"]),
        )
        .order_by(Transaction.fecha)
        .all()
    ):
        key = (tx.fecha.year, tx.fecha.month)
        cur = (tx.currency or "USD").upper()
        m = float(tx.monto_total)
        amt = _convert_amount(m, cur, target, db, tx.fecha)
        if tx.tipo in ("compra", "reinversion"):
            buckets[key]["acciones_compras"] += amt
        else:
            buckets[key]["acciones_ventas"] += amt

    for tx in (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.categoria == "Fondos",
            Transaction.tipo.in_(["deposito", "retiro"]),
        )
        .order_by(Transaction.fecha)
        .all()
    ):
        key = (tx.fecha.year, tx.fecha.month)
        try:
            m = abs(float(tx.monto_total))
        except (TypeError, ValueError):
            continue
        if m <= 1e-12:
            continue
        if (tx.tipo or "").lower() == "deposito":
            buckets[key]["fondos_depositos"] += m
        else:
            buckets[key]["fondos_retiros"] += m

    out: list[dict] = []
    for (y, mo) in sorted(buckets.keys()):
        b = buckets[(y, mo)]
        wi = b["wallet_ingresos"]
        we = b["wallet_egresos"]
        ac = b["acciones_compras"]
        av = b["acciones_ventas"]
        fd = b["fondos_depositos"]
        fr = b["fondos_retiros"]
        if scope == "wallet":
            ing, egr = wi, we
            cur_out = target
        elif scope == "stocks":
            ing, egr = ac, av
            cur_out = target
        elif scope == "fondos":
            ing, egr = fd, fr
            cur_out = "CLP"
        else:
            ing, egr = wi + av, we + ac
            cur_out = target
        out.append(
            {
                "year": y,
                "month": mo,
                "label": _month_label(y, mo),
                "ingresos": ing,
                "egresos": egr,
                "net": ing - egr,
                "currency": cur_out,
                "wallet_ingresos": wi,
                "wallet_egresos": we,
                "acciones_compras": ac,
                "acciones_ventas": av,
                "fondos_depositos": fd,
                "fondos_retiros": fr,
            }
        )
    return out


def _month_label(y: int, m: int) -> str:
    months = "ene feb mar abr may jun jul ago sep oct nov dic".split()
    return f"{months[m - 1]} {str(y)[-2:]}"


_DIVIDEND_DEDUP_EPS_USD = 0.02


def _fintual_dividend_signatures(db: Session, user_id: int) -> list[tuple[str, date, float]]:
    """
    Firmas de dividendos ya traídos por sync por símbolo (`Transaction` source=fintual).
    Sirve para no duplicar el mismo cobro en la lista cuando también existe en `WalletMovement`.
    """
    out: list[tuple[str, date, float]] = []
    for t in (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.source == "fintual",
            Transaction.tipo == "dividendo",
            Transaction.categoria == "Acciones",
        )
        .all()
    ):
        sym = (t.activo or "").upper().strip()
        if not sym:
            continue
        out.append((sym, t.fecha, float(t.monto_total)))
    return out


def _wallet_dividend_dup_of_fintual(
    w: WalletMovement, sigs: list[tuple[str, date, float]]
) -> bool:
    if (w.event_type or "").upper() != "DIVIDEND" or not w.symbol:
        return False
    sym = str(w.symbol).upper().strip()
    oc = w.occurred_at
    if isinstance(oc, datetime) and oc.tzinfo is not None:
        oc = oc.replace(tzinfo=None)
    fd = oc.date() if isinstance(oc, datetime) else oc
    try:
        amt = float(w.amount_usd) if w.amount_usd is not None else 0.0
    except (TypeError, ValueError):
        amt = 0.0
    for s, d, m in sigs:
        if s == sym and d == fd and abs(m - amt) <= _DIVIDEND_DEDUP_EPS_USD:
            return True
    return False


def _all_combined_rows(db: Session, user_id: int) -> list[dict[str, Any]]:
    combined: list[dict[str, Any]] = []
    div_sigs = _fintual_dividend_signatures(db, user_id)
    for w in (
        db.query(WalletMovement)
        .filter(WalletMovement.user_id == user_id)
        .order_by(WalletMovement.occurred_at.desc())
        .all()
    ):
        if _wallet_dividend_dup_of_fintual(w, div_sigs):
            continue
        combined.append(_wallet_to_row(w))
    for t in (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.categoria.in_(["Fondos", "AFP"]),
            Transaction.source != "fintual",
        )
        .all()
    ):
        combined.append(_manual_to_row(t))
    for t in (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.source == "fintual")
        .all()
    ):
        combined.append(_fintual_stock_row(t))
    combined.sort(key=lambda x: (x["_sort_at"], x["id"]), reverse=True)
    return combined


def _effective_tipo_for_filter(row: dict[str, Any]) -> str:
    """
    Tipo lógico para chips y filtro por tipo.
    Las reinversiones antiguas vienen como `compra` + texto en nombre_activo; se tratan como `reinversion`.
    """
    t = (row.get("tipo") or "").lower()
    if t == "reinversion":
        return "reinversion"
    if t == "compra":
        n = (row.get("nombre_activo") or "").lower()
        if "reinversión" in n or "reinversion" in n:
            return "reinversion"
    return t


def _filter_combined_rows(
    combined: list[dict[str, Any]],
    *,
    tipo: str | None = None,
    categoria: str | None = None,
    currency: str | None = None,
    q: str | None = None,
    activo_exact: str | None = None,
) -> list[dict[str, Any]]:
    rows = combined
    if tipo and tipo != "Todos":
        tl = tipo.lower()
        rows = [x for x in rows if _effective_tipo_for_filter(x) == tl]
    if categoria and categoria != "Todos":
        if categoria == "Acciones":
            rows = [
                x
                for x in rows
                if x["categoria"] in ("Acciones", "División Acción")
            ]
        else:
            rows = [x for x in rows if x["categoria"] == categoria]
    if currency and currency != "Todos":
        rows = [x for x in rows if x["currency"] == currency]
    if q and q.strip():
        raw = q.strip().upper()
        rows = [
            x
            for x in rows
            if raw in (x["activo"] or "").upper()
            or raw in (x.get("nombre_activo") or "").upper()
        ]
    if activo_exact and activo_exact.strip():
        sym = activo_exact.strip().upper()
        rows = [x for x in rows if (x.get("activo") or "").upper().strip() == sym]
    return rows


# Orden estable para chips de filtro (coincide con el listado histórico del frontend).
_TIPO_ORDER = [
    "dividendo",
    "deposito",
    "retiro",
    "interes_caja",
    "compensacion",
    "fusion_caja",
    "desinversion",
    "acat_ingreso",
    "acat_comision",
    "acat_egreso",
    "warrant_comision",
    "warrant_costo",
    "compra",
    "reinversion",
    "venta",
    "division_accion",
]


def distinct_transaction_tipos(
    db: Session,
    user_id: int,
    *,
    categoria: str | None = None,
    currency: str | None = None,
    q: str | None = None,
) -> list[str]:
    """Tipos presentes en datos filtrados por categoría/moneda/búsqueda (sin filtro por tipo)."""
    combined = _all_combined_rows(db, user_id)
    filtered = _filter_combined_rows(
        combined, tipo=None, categoria=categoria, currency=currency, q=q
    )
    present = {_effective_tipo_for_filter(x) for x in filtered}
    ordered = [t for t in _TIPO_ORDER if t in present]
    extra = sorted(present - set(_TIPO_ORDER))
    return ordered + extra


def query_transactions(
    db: Session,
    user_id: int,
    *,
    page: int = 1,
    page_size: int = 50,
    tipo: str | None = None,
    categoria: str | None = None,
    currency: str | None = None,
    q: str | None = None,
    activo_exact: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    combined = _all_combined_rows(db, user_id)
    combined = _filter_combined_rows(
        combined,
        tipo=tipo,
        categoria=categoria,
        currency=currency,
        q=q,
        activo_exact=activo_exact,
    )

    total = len(combined)
    start = (page - 1) * page_size
    rows = combined[start : start + page_size]
    for r in rows:
        r.pop("_sort_at", None)
    return rows, total
