"""
Helpers para incorporar NAV e invertido de metas Fintual (GQL balance graph) al historial
del portafolio. `compute_portfolio_history` (history.py) los usa para que `fondos_valor` /
`fondos_invertido` en `PortfolioValueCache` incluyan metas API, no solo activos manuales CLP.
"""

from __future__ import annotations

import bisect
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any

from fintual_client import fetch_goal_balance_graph_points, use_fintual_credentials
from fintual_goals_dashboard import fetch_active_goal_cards
from models import User
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


def _fetch_goal_balance_graph_in_thread(
    gid: str,
    session_cookie: str | None,
    uid: str | None,
) -> tuple[str, list[dict[str, Any]] | None, Exception | None]:
    with use_fintual_credentials(session_cookie, uid):
        try:
            return gid, fetch_goal_balance_graph_points(gid, "all_time"), None
        except Exception as exc:
            return gid, None, exc


def _goal_balance_series_list(db: Session, user_id: int) -> list[list[tuple[date, float, float]]]:
    """Una serie ordenada por meta; cada una con forward-fill independiente antes de sumar."""
    cards = fetch_active_goal_cards(db, user_id=user_id)
    goal_ids = [str(c.get("id") or "").strip() for c in cards]
    goal_ids = [gid for gid in goal_ids if gid]

    out: list[list[tuple[date, float, float]]] = []
    if not goal_ids:
        return out

    u_row = db.query(User).filter(User.id == user_id).first()
    fs = ((u_row.fintual_session or "").strip() if u_row else "") or None
    fu = ((u_row.fintual_uid or "").strip() if u_row else "") or None

    workers = min(10, len(goal_ids))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {
            ex.submit(_fetch_goal_balance_graph_in_thread, gid, fs, fu): gid for gid in goal_ids
        }
        for fut in as_completed(futs):
            gid, pts, err = fut.result()
            if err is not None:
                logger.debug("balance graph %s: %s", gid, err)
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
