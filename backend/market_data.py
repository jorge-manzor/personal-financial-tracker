"""
Precios de mercado: solo datos locales (price_cache) rellenados por Fintual (`fintual_sync`).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from database import SessionLocal
from history import ensure_cache, get_first_transaction_date, get_last_trading_day, get_tickers_from_transactions
from models import PortfolioValueCache, PriceCache

logger = logging.getLogger(__name__)

HTTP_TIMEOUT = 60.0
CL = ZoneInfo("America/Santiago")
CURRENT_PRICE_TTL = timedelta(minutes=15)
# Ya no hay benchmark externo; tupla vacía para compatibilidad con imports.
BENCHMARK_TICKERS: tuple[str, ...] = ()


def _today_chile() -> date:
    return datetime.now(CL).date()


def _last_cached_close(db: Session, ticker: str) -> float | None:
    sym = ticker.upper()
    row = (
        db.query(PriceCache)
        .filter(PriceCache.ticker == sym)
        .order_by(PriceCache.date.desc())
        .first()
    )
    return float(row.close_price) if row else None


def _current_price_row_fresh(db: Session, ticker: str) -> tuple[float | None, bool]:
    sym = ticker.upper()
    today = _today_chile()
    row = (
        db.query(PriceCache)
        .filter(PriceCache.ticker == sym, PriceCache.date == today)
        .first()
    )
    if not row:
        return None, False
    fetched = row.fetched_at
    if fetched.tzinfo is None:
        fresh = datetime.utcnow() - fetched.replace(tzinfo=None) < CURRENT_PRICE_TTL
    else:
        fresh = datetime.now(fetched.tzinfo) - fetched < CURRENT_PRICE_TTL
    if not fresh:
        return float(row.close_price), False
    return float(row.close_price), True


async def get_current_prices(
    db: Session, tickers: list[str], *, user_id: int, force: bool = False
) -> dict[str, float]:
    """Precios actuales vía Fintual (si hay sesión) y cache local."""
    from fintual_client import fintual_configured
    from fintual_sync import sync_current_prices_batch

    syms = [raw.upper().strip() for raw in tickers if raw and raw.strip()]
    need_fetch = force
    if not need_fetch and syms:
        for s in syms:
            px, fresh = _current_price_row_fresh(db, s)
            if not fresh or px is None:
                need_fetch = True
                break
    if fintual_configured() and syms and need_fetch:
        try:
            sync_current_prices_batch(db, syms, user_id)
        except Exception as e:
            logger.warning("Fintual current prices: %s", e)
            from fintual_auth_state import is_likely_fintual_auth_error, mark_fintual_reconnect_required

            if is_likely_fintual_auth_error(e):
                mark_fintual_reconnect_required(user_id)

    out: dict[str, float] = {}
    for sym in syms:
        if not force:
            px, fresh = _current_price_row_fresh(db, sym)
            if fresh and px is not None:
                out[sym] = px
                continue
        last = _last_cached_close(db, sym)
        if last is not None:
            out[sym] = last
    return out


async def get_historical_prices(
    db: Session,
    ticker: str,
    user_id: int,
    _period: str = "ALL",
    *,
    force: bool = False,
) -> list[dict]:
    """No-op: el histórico lo llena `fintual_sync`. Devuelve serie desde cache."""
    from fintual_sync import sync_historical_prices_for_symbol

    sym = ticker.upper().strip()
    if not sym:
        return []
    if force:
        sync_historical_prices_for_symbol(db, sym, user_id=user_id, force=True)
    rows = (
        db.query(PriceCache)
        .filter(PriceCache.ticker == sym)
        .order_by(PriceCache.date.asc())
        .all()
    )
    return [{"date": r.date.isoformat(), "price": float(r.close_price)} for r in rows]


async def get_all_historical_for_portfolio(db: Session, period: str, user_id: int) -> dict[str, list]:
    tickers = get_tickers_from_transactions(db, user_id)
    result: dict[str, list] = {}
    for sym in tickers:
        rows = await get_historical_prices(db, sym, user_id, period)
        result[sym] = rows
    return result


def build_portfolio_history(period: str, user_id: int) -> list[dict]:
    db = SessionLocal()
    try:
        ensure_cache(db, user_id, force=True)
        last_day = get_last_trading_day()
        first_tx = get_first_transaction_date(db, user_id)
        start = first_tx or last_day
        by_date: dict[date, dict] = {}
        for r in (
            db.query(PortfolioValueCache)
            .filter(
                PortfolioValueCache.user_id == user_id,
                PortfolioValueCache.fecha >= start,
                PortfolioValueCache.fecha <= last_day,
            )
            .all()
        ):
            by_date.setdefault(r.fecha, {})[r.categoria] = r

        out: list[dict] = []
        for d in sorted(by_date.keys()):
            m = by_date[d]
            acc = m.get("acciones")
            fondos = m.get("fondos")
            man = m.get("manuales")
            tot = m.get("total")
            out.append(
                {
                    "date": d.isoformat(),
                    "acciones_valor": acc.valor if acc else 0.0,
                    "acciones_invertido": acc.invertido if acc else 0.0,
                    "fondos_valor": fondos.valor if fondos else 0.0,
                    "fondos_invertido": fondos.invertido if fondos else 0.0,
                    "manuales_valor": man.valor if man else 0.0,
                    "total": tot.valor if tot else 0.0,
                    "total_invertido": tot.invertido if tot else 0.0,
                }
            )
        return out
    finally:
        db.close()


def sync_get_current_prices(tickers: list[str], user_id: int) -> dict[str, float]:
    db = SessionLocal()
    try:
        return asyncio.run(get_current_prices(db, tickers, user_id=user_id))
    finally:
        db.close()


async def sync_pipeline_prices_and_portfolio(db: Session, force: bool, user_id: int) -> None:
    from exchange_service import store_today_rate
    from fintual_auth_state import (
        clear_fintual_reconnect_required,
        is_likely_fintual_auth_error,
        mark_fintual_reconnect_required,
    )
    from fintual_sync import sync_all_fintual

    try:
        store_today_rate(db)
    except Exception as e:
        logger.warning("exchange rate fetch: %s", e)
        db.rollback()

    try:
        sync_all_fintual(db, user_id, force_prices=force)
        ensure_cache(db, user_id, force=force)
        clear_fintual_reconnect_required(db, user_id)
    except Exception as e:
        if is_likely_fintual_auth_error(e):
            mark_fintual_reconnect_required(user_id)
        raise
