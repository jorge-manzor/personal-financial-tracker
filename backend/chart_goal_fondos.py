"""
Enriquece filas del gráfico de portafolio con NAV e invertido de metas Fintual (GQL balance graph).

El cache histórico (`compute_portfolio_history`) solo incluye fondos desde activos manuales CLP;
las metas API no estaban en `fondos_valor` / `fondos_invertido`, por eso las líneas salían en 0.
"""

from __future__ import annotations

import bisect
import logging
from datetime import date
from typing import Any

from exchange_service import get_rate_for_date
from fintual_client import fetch_goal_balance_graph_points, fintual_configured
from fintual_goals_dashboard import fetch_active_goal_cards
from schemas import ChartRow
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _parse_graph_date(raw: object) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    if "T" in s:
        s = s.split("T")[0]
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _dedupe_goal_points_to_series(pts: list[dict[str, Any]]) -> list[tuple[date, float, float]]:
    """
    Un punto por fecha por meta (último gana). Evita duplicados GQL que duplicaban NAV al sumar con +=.
    """
    by_d: dict[date, tuple[float, float]] = {}
    for p in pts:
        d = _parse_graph_date(p.get("date"))
        if d is None:
            continue
        try:
            v = float(p.get("sharesValuationAmount") or 0.0)
            cst = float(p.get("sharesCostBasisAmount") or 0.0)
        except (TypeError, ValueError):
            continue
        by_d[d] = (v, cst)
    return [(d, a, b) for d, (a, b) in sorted(by_d.items())]


def _goal_balance_series_list(db: Session) -> list[list[tuple[date, float, float]]]:
    """Una serie ordenada por meta; cada una con forward-fill independiente antes de sumar."""
    cards = fetch_active_goal_cards(db)
    out: list[list[tuple[date, float, float]]] = []
    for c in cards:
        gid = str(c.get("id") or "").strip()
        if not gid:
            continue
        try:
            pts = fetch_goal_balance_graph_points(gid, "all_time")
        except Exception as exc:
            logger.debug("balance graph %s: %s", gid, exc)
            continue
        if not pts:
            continue
        raw = pts if isinstance(pts, list) else []
        series = _dedupe_goal_points_to_series(raw)
        if series:
            out.append(series)
    return out


def _forward_fill_val_cost(
    series: list[tuple[date, float, float]], d: date
) -> tuple[float, float]:
    """Último punto con fecha <= d (serie ordenada por fecha)."""
    if not series:
        return 0.0, 0.0
    dates = [s[0] for s in series]
    i = bisect.bisect_right(dates, d) - 1
    if i < 0:
        return 0.0, 0.0
    _, v, c = series[i]
    return v, c


def augment_chart_rows_with_fintual_goal_balance(db: Session, rows: list[ChartRow]) -> list[ChartRow]:
    if not fintual_configured() or not rows:
        return rows
    per_goal = _goal_balance_series_list(db)
    if not per_goal:
        return rows

    out: list[ChartRow] = []
    for row in rows:
        rate = float(get_rate_for_date(db, row.date))
        if rate <= 0:
            rate = 950.0
        gv_clp = 0.0
        gc_clp = 0.0
        for goal_series in per_goal:
            v, c = _forward_fill_val_cost(goal_series, row.date)
            gv_clp += v
            gc_clp += c
        gv_usd = gv_clp / rate
        gc_usd = gc_clp / rate

        fv = float(row.fondos_valor) + gv_usd
        fi = max(float(row.fondos_invertido), gc_usd)

        av = float(row.acciones_valor)
        ai = float(row.acciones_invertido)
        afv = float(row.afp_valor)
        afi = float(row.afp_invertido)
        mv = float(row.manuales_valor)

        tv = av + fv + afv + mv
        ti = ai + fi + afi

        out.append(
            row.model_copy(
                update={
                    "fondos_valor": fv,
                    "fondos_invertido": fi,
                    "total_valor": tv,
                    "total_invertido": ti,
                    "total_valor_clp": tv * rate,
                    "total_invertido_clp": ti * rate,
                    "fx_usd_clp": rate,
                }
            )
        )
    return out
