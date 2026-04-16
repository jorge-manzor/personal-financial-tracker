from __future__ import annotations

import json
import logging
import urllib.request
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import desc, func
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from fx_usd_clp import cmf_configured, get_current_rate, get_historical_rates
from models import ExchangeRateHistory

logger = logging.getLogger(__name__)


def _fallback_rate_legacy() -> tuple[float, str]:
    """Último recurso si DolarAPI y CMF fallan."""
    try:
        req = urllib.request.Request(
            "https://mindicador.cl/api/dolar",
            headers={"User-Agent": "portfolio-tracker/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        serie = data.get("serie") or []
        if serie:
            return float(serie[0]["valor"]), "mindicador.cl"
    except Exception as e:
        logger.warning("mindicador fallback failed: %s", e)
    return 950.0, "fallback"


def store_today_rate(db: Session) -> ExchangeRateHistory | None:
    """Valor spot USD/CLP (DolarAPI → CMF) y persiste el día en curso."""
    try:
        fx = get_current_rate()
        rate = float(fx["venta"])
        source = str(fx.get("fuente", "dolarapi"))
    except Exception as e:
        logger.warning("FX live failed: %s", e)
        rate, source = _fallback_rate_legacy()

    today = datetime.now(timezone.utc).date()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    stmt = sqlite_insert(ExchangeRateHistory).values(
        date=today,
        usd_to_clp=rate,
        source=source,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[ExchangeRateHistory.date],
        set_={
            "usd_to_clp": stmt.excluded.usd_to_clp,
            "source": stmt.excluded.source,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    db.execute(stmt)
    db.commit()
    row = db.query(ExchangeRateHistory).filter(ExchangeRateHistory.date == today).one()
    return row


def ensure_exchange_history(db: Session) -> None:
    """
    Rellena huecos en exchange_rate_history usando CMF (histórico oficial).
    No llama a DolarAPI — el spot lo resuelve store_today_rate / POST refresh.
    """
    from history import get_first_transaction_date

    if not cmf_configured():
        logger.debug("CMF_API_KEY ausente — omitiendo backfill histórico USD/CLP")
        return

    first_tx = get_first_transaction_date(db)
    default_start = date(2020, 1, 1)
    if first_tx:
        start = max(default_start, first_tx - timedelta(days=90))
    else:
        start = default_start

    today = date.today()
    last = db.query(func.max(ExchangeRateHistory.date)).scalar()

    if last is None:
        fetch_start = start
    elif last >= today:
        return
    else:
        fetch_start = last + timedelta(days=1)

    # Histórico oficial hasta ayer; el día en curso lo actualiza DolarAPI (POST /exchange-rate/refresh).
    cmf_end = today - timedelta(days=1)
    if fetch_start > cmf_end:
        return

    try:
        rows = get_historical_rates(fetch_start, cmf_end)
    except Exception as e:
        logger.warning("Histórico CMF USD/CLP no disponible: %s", e)
        return

    if not rows:
        return

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for r in rows:
        f = r["fecha"]
        d = date.fromisoformat(f) if isinstance(f, str) else f
        if d >= today:
            continue
        val = float(r["valor"])
        row = db.query(ExchangeRateHistory).filter(ExchangeRateHistory.date == d).first()
        if row:
            row.usd_to_clp = val
            row.source = "cmf_chile"
            row.updated_at = now
        else:
            db.add(
                ExchangeRateHistory(
                    date=d,
                    usd_to_clp=val,
                    source="cmf_chile",
                    updated_at=now,
                )
            )
    db.commit()


def get_latest_rate(db: Session) -> float | None:
    row = db.query(ExchangeRateHistory).order_by(desc(ExchangeRateHistory.date)).first()
    return float(row.usd_to_clp) if row else None


def get_rate_for_date(db: Session, d: date) -> float:
    """Último tipo guardado en o antes de d; si no hay, último global; si no, fallback."""
    row = (
        db.query(ExchangeRateHistory)
        .filter(ExchangeRateHistory.date <= d)
        .order_by(desc(ExchangeRateHistory.date))
        .first()
    )
    if row:
        return float(row.usd_to_clp)
    row = db.query(ExchangeRateHistory).order_by(desc(ExchangeRateHistory.date)).first()
    if row:
        return float(row.usd_to_clp)
    return 950.0


def get_previous_rate(db: Session) -> float | None:
    rows = (
        db.query(ExchangeRateHistory)
        .order_by(desc(ExchangeRateHistory.date))
        .limit(2)
        .all()
    )
    if len(rows) >= 2:
        return float(rows[1].usd_to_clp)
    return None
