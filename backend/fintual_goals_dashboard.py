"""Metas/fondos Fintual para tarjetas del dashboard (GET /api/goals/) + respaldo desde transacciones sync."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from fintual_client import (
    fintual_configured,
    fetch_goal_balance_graph_points,
    get_goals_rest,
    portal_balance_snapshot_from_graph,
)
from models import Transaction

logger = logging.getLogger(__name__)


def _first_float(attr: dict[str, Any], *keys: str, default: float = 0.0) -> float:
    """La API JSON:API a veces usa `profit` y otras `profit_clp` / camelCase."""
    for k in keys:
        if k not in attr:
            continue
        v = attr[k]
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return default


def _nav_clp_from_api(attr: dict[str, Any]) -> float:
    """
    Valor cuota actual. Fintual puede enviar `nav` distinto de `nav_clp`; la app usa el mismo criterio
    que el cliente web: priorizar `nav_clp` cuando exista.
    """
    return _first_float(attr, "nav_clp", "nav", "navClp")


def _deposited_net_clp_from_api(attr: dict[str, Any]) -> float:
    """
    Capital neto depositado en la meta (aportes − retiros contables en ese campo), no el total histórico
    (`not_net_deposited` / total_deposited_clp).
    """
    return _first_float(attr, "deposited_clp", "deposited", "depositedClp")


def _withdrawn_clp(attr: dict[str, Any]) -> float:
    return _first_float(attr, "withdrawn", "withdrawn_clp", "withdrawnClp", "total_withdrawn", "withdrawals")


_NESTED_BLOCKS = ("performance", "metrics", "summary", "stats", "totals", "balances", "details")
# En anidados Fintual suele mandar los montos canónicos; la raíz a veces trae `nav`/`deposited` desactualizados.
_METRICS_OVERRIDE_KEYS = (
    "nav_clp",
    "navClp",
    "deposited_clp",
    "depositedClp",
    "profit_clp",
    "profitClp",
    "profit",
    "withdrawn_clp",
    "withdrawnClp",
)


def _flatten_goal_attributes(g: dict[str, Any]) -> dict[str, Any]:
    """
    JSON:API: `meta` + sub-objetos (`performance`, etc.). Primero copiamos claves que falten en la raíz;
    luego las métricas `*_clp` / `profit` definidas **dentro** de esos bloques pisan la raíz (valores canónicos).
    """
    attr = dict(g.get("attributes") or {})
    meta = g.get("meta")
    if isinstance(meta, dict):
        for k, v in meta.items():
            if k not in attr:
                attr[k] = v
    for nk in _NESTED_BLOCKS:
        nested = attr.get(nk)
        if isinstance(nested, dict):
            for k, v in nested.items():
                if k not in attr:
                    attr[k] = v
    for nk in _NESTED_BLOCKS:
        nested = attr.get(nk)
        if not isinstance(nested, dict):
            continue
        for k in _METRICS_OVERRIDE_KEYS:
            if k not in nested or nested[k] is None:
                continue
            try:
                float(nested[k])
            except (TypeError, ValueError):
                continue
            attr[k] = nested[k]
    if isinstance(meta, dict):
        for k in _METRICS_OVERRIDE_KEYS:
            if k not in meta or meta[k] is None:
                continue
            try:
                float(meta[k])
            except (TypeError, ValueError):
                continue
            attr[k] = meta[k]
    return attr


def _profit_clp_from_api(attr: dict[str, Any]) -> float:
    """Ganancia en CLP tal como la envía GET /api/goals/ (`profit_clp`; a veces `profit` en respuestas viejas)."""
    return _first_float(
        attr,
        "profit_clp",
        "profitClp",
        "profit",
        "total_profit",
        "total_profit_clp",
    )


def _profit_pct_display(deposited: float, withdrawn: float, profit: float, nav: float) -> float:
    """
    Rentabilidad % alineada con `profit_clp` y el NAV.

    No usar (depositado − retirado) cuando `deposited_clp` ya es capital **neto** en la API: si además
    restamos `withdrawn`, el denominador puede ser muy negativo y el % queda invertido (caso metas con
    retiros fuertes, p. ej. Vacaciones) pese a ganancia positiva.

    Orden: base implícita NAV − ganancia = capital sobre el que rinde; luego depositado neto; último
    recurso depositado − retirado (cuando `deposited` fuera bruto).
    """
    cost_basis = nav - profit
    if cost_basis > 1e-6:
        return profit / cost_basis * 100.0
    if deposited > 1e-6:
        return profit / deposited * 100.0
    net_in = deposited - withdrawn
    if abs(net_in) > 1e-6:
        return profit / net_in * 100.0
    if abs(cost_basis) > 1e-6:
        return profit / cost_basis * 100.0
    return 0.0


def _badge_from_goal(attr: dict[str, Any]) -> str:
    """Etiqueta según `timeframe` (meses) en la respuesta de goals; la API usa p. ej. 1, 24, 36."""
    tf = attr.get("timeframe_months")
    if tf is None:
        tf = attr.get("timeframe")
    try:
        months = int(tf) if tf is not None else None
    except (TypeError, ValueError):
        months = None
    if months == 1:
        return "RESERVA"
    if months == 24:
        return "MEDIANO PLAZO"
    if months == 36:
        return "LARGO PLAZO"
    return "INVERSIÓN"


def _cards_from_synced_fondos_tx(db: Session) -> list[dict[str, Any]]:
    """
    Tarjetas a partir de movimientos ya guardados (sync Fintual) cuando la REST de goals
    no responde o va vacía — al menos id + nombre + montos aproximados en CLP.
    """
    groups = (
        db.query(Transaction.activo, func.max(Transaction.nombre_activo))
        .filter(
            Transaction.categoria == "Fondos",
            Transaction.source == "fintual",
        )
        .group_by(Transaction.activo)
        .all()
    )
    out: list[dict[str, Any]] = []
    for activo, nombre_max in groups:
        gid = str(activo or "").strip()
        if not gid:
            continue
        txs = (
            db.query(Transaction)
            .filter(
                Transaction.categoria == "Fondos",
                Transaction.source == "fintual",
                Transaction.activo == gid,
            )
            .all()
        )
        name = (nombre_max or "").strip() or f"Meta {gid}"
        dep = 0.0
        ret = 0.0
        for t in txs:
            tipo = (t.tipo or "").lower()
            try:
                m = abs(float(t.monto_total or 0.0))
            except (TypeError, ValueError):
                continue
            if tipo == "deposito":
                dep += m
            elif tipo == "retiro":
                ret += m
        net = dep - ret
        # Sin API: aproximamos NAV y “depositado” con el saldo neto por movimientos (no suma bruta de depósitos).
        profit_clp = 0.0
        profit_pct = 0.0
        net_pos = max(net, 0.0)
        out.append(
            {
                "id": gid,
                "name": name,
                "nav_clp": net_pos,
                "deposited_clp": net_pos,
                "profit_clp": profit_clp,
                "profit_pct": profit_pct,
                "badge_label": "INVERSIÓN",
            }
        )
    out.sort(key=lambda x: (-x["nav_clp"], x["name"].lower()))
    return out


def _cards_from_goals_api() -> list[dict[str, Any]]:
    if not fintual_configured():
        return []
    try:
        raw = get_goals_rest()
    except Exception as exc:
        logger.warning("Fintual GET /api/goals/: %s", exc)
        return []

    if not raw:
        logger.info("Fintual GET /api/goals/ devolvió 0 ítems (sesión en .env o cookies).")

    out: list[dict[str, Any]] = []
    for g in raw:
        attr = _flatten_goal_attributes(g)
        # No filtrar por `completed`: en Fintual suele marcar meta cumplida aunque el fondo siga activo;
        # si las excluimos, `fetch_active_goal_cards` cae solo en el respaldo DB (datos malos / ganancia 0).
        gid = str(g.get("id", "")).strip()
        if not gid:
            continue
        nav = _nav_clp_from_api(attr)
        deposited = _deposited_net_clp_from_api(attr)
        withdrawn = _withdrawn_clp(attr)
        profit = _profit_clp_from_api(attr)
        name = str(attr.get("name") or "").strip() or f"Meta {gid}"
        profit_pct = _profit_pct_display(deposited, withdrawn, profit, nav)
        out.append(
            {
                "id": gid,
                "name": name,
                "nav_clp": nav,
                "deposited_clp": deposited,
                "profit_clp": profit,
                "profit_pct": profit_pct,
                "badge_label": _badge_from_goal(attr),
            }
        )

    _enrich_goal_cards_with_portal_balance_graph(out)

    out.sort(
        key=lambda x: (
            0 if (x["nav_clp"] > 1e-6 or x["deposited_clp"] > 1e-6) else 1,
            -x["nav_clp"],
            x["name"].lower(),
        )
    )
    return out


def _enrich_goal_cards_with_portal_balance_graph(cards: list[dict[str, Any]]) -> None:
    """
    Alinea NAV, “depositado” y ganancia con el **último punto** del gráfico de balance (GQL),
    igual que la ficha en fintual.cl.

    Tras retiros, el costo de cuotas (`sharesCostBasisAmount`) es el capital neto sobre el que
    Fintual calcula la rentabilidad; no mezclar con `deposited_clp` / `nav_clp` del REST si quedan
    desfasados respecto a esa serie.
    """
    if not cards:
        return
    by_id = {c["id"]: c for c in cards}

    def _fetch_portal(gid: str) -> tuple[str, tuple[float, float, float, float] | None]:
        try:
            pts = fetch_goal_balance_graph_points(gid)
            return gid, portal_balance_snapshot_from_graph(pts)
        except Exception as exc:
            logger.debug("clGoalBalanceGraphDataPoints %s: %s", gid, exc)
            return gid, None

    n = len(by_id)
    workers = min(8, max(1, n))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(_fetch_portal, gid) for gid in by_id]
        for fut in as_completed(futures):
            gid, r = fut.result()
            if r is None or gid not in by_id:
                continue
            nav_clp, deposited_clp, profit_clp, profit_pct = r
            c = by_id[gid]
            c["nav_clp"] = nav_clp
            c["deposited_clp"] = deposited_clp
            c["profit_clp"] = profit_clp
            c["profit_pct"] = profit_pct


def fetch_active_goal_cards(db: Session | None = None) -> list[dict[str, Any]]:
    """
    Metas para el dashboard: primero API de goals (NAV real); si falta algo, rellena con
    metas vistas solo en el sync de movimientos (mismo `activo` = id de meta).
    """
    by_id: dict[str, dict[str, Any]] = {}
    for c in _cards_from_goals_api():
        by_id[c["id"]] = c

    if db is not None:
        for c in _cards_from_synced_fondos_tx(db):
            if c["id"] not in by_id:
                by_id[c["id"]] = c
                logger.debug("Meta %s desde tarjetas solo-DB (sync movimientos)", c["id"])

    out = list(by_id.values())
    out.sort(
        key=lambda x: (
            0 if (x["nav_clp"] > 1e-6 or x["deposited_clp"] > 1e-6) else 1,
            -x["nav_clp"],
            x["name"].lower(),
        )
    )
    return out
