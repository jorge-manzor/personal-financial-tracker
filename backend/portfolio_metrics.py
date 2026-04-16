from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, time
from typing import cast

from sqlalchemy import func
from sqlalchemy.orm import Session

from history import (
    fondos_afp_invertido_usd_now,
    get_last_trading_day,
    get_tickers_from_transactions,
    manual_breakdown_usd_at_date,
    transaction_occurred_at,
)
from market_data import get_current_prices
from models import FintualPosition, PriceCache, StockSplit, Transaction
from exchange_service import get_latest_rate

logger = logging.getLogger(__name__)


def _replay_symbol_usd(db: Session, sym: str, user_id: int) -> tuple[float, float, float, float, float]:
    """
    Desde transacciones Acciones USD + splits (`stock_splits`): (shares, cost_basis, realized_pnl, dividendos, sum_compras).
    """
    su = sym.upper().strip()
    txs = sorted(
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            func.upper(func.trim(Transaction.activo)) == su,
            Transaction.categoria == "Acciones",
            Transaction.currency == "USD",
        )
        .all(),
        key=lambda t: (transaction_occurred_at(t), t.id),
    )
    splits = (
        db.query(StockSplit)
        .filter(StockSplit.user_id == user_id, StockSplit.symbol == su)
        .order_by(StockSplit.split_date, StockSplit.id)
        .all()
    )

    def _split_dt(sp: StockSplit) -> datetime:
        return datetime.combine(sp.split_date, time(0, 0, 0))

    events: list[tuple[datetime, int, int, object]] = []
    for sp in splits:
        events.append((_split_dt(sp), 0, sp.id or 0, sp))
    for tx in txs:
        events.append((transaction_occurred_at(tx), 1, tx.id, tx))
    events.sort(key=lambda x: (x[0], x[1], x[2]))

    shares = 0.0
    cost_basis = 0.0
    realized = 0.0
    dividendos = 0.0
    sum_compras = 0.0
    for _, kind, _, payload in events:
        if kind == 0:
            rate = float(cast(StockSplit, payload).rate)
            if rate > 0 and shares > 1e-12:
                shares *= rate
            continue
        tx = cast(Transaction, payload)
        tipo = (tx.tipo or "").lower()
        if tipo in ("compra", "reinversion"):
            sh = float(tx.acciones)
            m = float(tx.monto_total)
            shares += sh
            cost_basis += m
            sum_compras += m
        elif tipo == "venta":
            sh = float(tx.acciones)
            proceeds = float(tx.monto_total)
            avg = cost_basis / shares if shares > 1e-12 else 0.0
            cost_sold = avg * sh
            shares -= sh
            cost_basis -= cost_sold
            realized += proceeds - cost_sold
            if shares < 1e-9:
                shares = 0.0
                cost_basis = 0.0
        elif tipo == "dividendo":
            dividendos += float(tx.monto_total)
    return shares, cost_basis, realized, dividendos, sum_compras


def _resolved_price_and_unavailable(
    db: Session, sym: str, prices: dict[str, float]
) -> tuple[float, bool]:
    """Use live quote from `prices`, else latest PriceCache; unavailable only if no usable price."""
    px = prices.get(sym)
    if px is not None:
        return px, px <= 0
    row = (
        db.query(PriceCache)
        .filter(PriceCache.ticker == sym)
        .order_by(PriceCache.date.desc())
        .first()
    )
    if row is not None:
        v = float(row.close_price)
        return v, v <= 0
    return 0.0, True


def market_price(db: Session, ticker: str, user_id: int) -> float | None:
    sym = ticker.upper().strip()
    try:
        out = asyncio.run(get_current_prices(db, [sym], user_id=user_id))
        return out.get(sym)
    except Exception:
        row = (
            db.query(PriceCache)
            .filter(PriceCache.ticker == sym)
            .order_by(PriceCache.date.desc())
            .first()
        )
        return float(row.close_price) if row else None


def sp500_change_pct(db: Session) -> float | None:
    """Indicador externo eliminado; reservado por compatibilidad."""
    return None


def compute_ticker_metrics(
    db: Session,
    ticker: str,
    current_price: float,
    user_id: int,
    *,
    price_unavailable: bool = False,
) -> dict:
    sym = ticker.upper().strip()
    pos = (
        db.query(FintualPosition)
        .filter(FintualPosition.user_id == user_id, FintualPosition.symbol == sym)
        .first()
    )
    shares_replay, cost_basis, realized, dividendos, sum_compras = _replay_symbol_usd(db, sym, user_id)
    if shares_replay > 1e-12:
        total_shares = shares_replay
    elif pos:
        total_shares = float(pos.shares)
    else:
        total_shares = 0.0
    if total_shares <= 1e-12:
        return {
            "ticker": sym,
            "nombre": sym,
            "total_shares": 0.0,
            "avg_buy_price": 0.0,
            "capital_invertido": 0.0,
            "capital_inicial_total": 0.0,
            "current_price": current_price,
            "current_value": 0.0,
            "ganancia_realizada": realized,
            "ganancia_no_realizada": 0.0,
            "dividendos": dividendos,
            "ganancia_total": realized + dividendos,
            "rentabilidad_realizada_pct": (realized / sum_compras * 100.0) if sum_compras > 0 else None,
            "rentabilidad_no_realizada_pct": None,
            "rentabilidad_total_pct": ((realized + dividendos) / sum_compras * 100.0) if sum_compras > 0 else None,
            "sector": None,
            "price_unavailable": price_unavailable,
        }

    nombre = ((pos.name if pos else None) or sym).strip()
    sector = pos.sector if pos else None
    avg_buy_price = cost_basis / total_shares if total_shares > 1e-12 else 0.0
    capital_invertido = cost_basis
    capital_inicial_total = sum_compras
    current_value = total_shares * current_price
    ganancia_no_realizada = current_value - cost_basis
    ganancia_total = realized + ganancia_no_realizada + dividendos

    r_real = (realized / sum_compras * 100.0) if sum_compras > 0 else None
    r_unr = (ganancia_no_realizada / cost_basis * 100.0) if cost_basis > 1e-12 else None
    r_tot = (ganancia_total / sum_compras * 100.0) if sum_compras > 0 else None

    return {
        "ticker": sym,
        "nombre": nombre,
        "total_shares": total_shares,
        "avg_buy_price": avg_buy_price,
        "capital_invertido": capital_invertido,
        "capital_inicial_total": capital_inicial_total,
        "current_price": current_price,
        "current_value": current_value,
        "ganancia_realizada": realized,
        "ganancia_no_realizada": ganancia_no_realizada,
        "dividendos": dividendos,
        "ganancia_total": ganancia_total,
        "rentabilidad_realizada_pct": r_real,
        "rentabilidad_no_realizada_pct": r_unr,
        "rentabilidad_total_pct": r_tot,
        "sector": sector,
        "price_unavailable": price_unavailable,
    }


def get_open_tickers(db: Session, user_id: int) -> list[str]:
    return get_tickers_from_transactions(db, user_id)


def portfolio_total_value(db: Session, user_id: int) -> float:
    syms = get_open_tickers(db, user_id)
    prices = asyncio.run(get_current_prices(db, syms, user_id=user_id)) if syms else {}
    total = 0.0
    for sym in syms:
        px, unavail = _resolved_price_and_unavailable(db, sym, prices)
        m = compute_ticker_metrics(db, sym, px or 0.0, user_id, price_unavailable=unavail)
        total += m["current_value"]
    d = get_last_trading_day()
    b = manual_breakdown_usd_at_date(db, d, user_id)
    total += b["manual_total_usd"]
    return total


def holdings_with_metrics(
    db: Session, user_id: int, *, prices: dict[str, float] | None = None
) -> list[dict]:
    syms = get_open_tickers(db, user_id)
    if not syms:
        return []
    if prices is None:
        prices = asyncio.run(get_current_prices(db, syms, user_id=user_id))
    out: list[dict] = []
    for sym in syms:
        px, unavail = _resolved_price_and_unavailable(db, sym, prices)
        m = compute_ticker_metrics(db, sym, px, user_id, price_unavailable=unavail)
        if m["total_shares"] <= 0:
            continue
        out.append(m)
    total_acc = sum(m["current_value"] for m in out)
    d = get_last_trading_day()
    mb = manual_breakdown_usd_at_date(db, d, user_id)
    total_pf = total_acc + mb["manual_total_usd"]
    for m in out:
        m["peso_portafolio_pct"] = (m["current_value"] / total_pf * 100.0) if total_pf > 0 else 0.0
        m.setdefault("logo_url", None)
    return out


def portfolio_summary(db: Session, user_id: int, *, prices: dict[str, float] | None = None) -> dict:
    syms = get_open_tickers(db, user_id)
    if prices is None:
        prices = asyncio.run(get_current_prices(db, syms, user_id=user_id)) if syms else {}
    hs = []
    for sym in syms:
        px, unavail = _resolved_price_and_unavailable(db, sym, prices)
        m = compute_ticker_metrics(db, sym, px, user_id, price_unavailable=unavail)
        if m["total_shares"] > 0:
            hs.append(m)

    d = get_last_trading_day()
    mb = manual_breakdown_usd_at_date(db, d, user_id)
    rate = get_latest_rate(db) or mb.get("exchange_rate_usd_clp") or 950.0

    acciones_value = sum(m["current_value"] for m in hs)
    manuales_usd_only = mb["manuales_usd"]

    total_realized = sum(m["ganancia_realizada"] for m in hs)
    total_unrealized = sum(m["ganancia_no_realizada"] for m in hs)
    total_dividends = sum(m["dividendos"] for m in hs)
    invertido_acciones = sum(m["capital_invertido"] for m in hs)
    invertido_fondos_afp = fondos_afp_invertido_usd_now(db, user_id)
    total_invested = invertido_acciones + invertido_fondos_afp

    manual_total_usd = mb["manual_total_usd"]
    total_value = acciones_value + manual_total_usd
    total_gain = total_value - total_invested
    total_gain_pct = (total_gain / total_invested * 100.0) if total_invested > 0 else 0.0

    return {
        "total_value": total_value,
        "total_invested": total_invested,
        "total_gain": total_gain,
        "total_gain_pct": total_gain_pct,
        "total_realized": total_realized,
        "total_unrealized": total_unrealized,
        "total_dividends": total_dividends,
        "acciones_value": acciones_value,
        "manuales_value": manuales_usd_only,
        "fondos_clp": mb["fondos_clp"],
        "fondos_usd_equiv": mb["fondos_usd_equiv"],
        "afp_clp": mb["afp_clp"],
        "afp_usd_equiv": mb["afp_usd_equiv"],
        "exchange_rate_usd_clp": rate,
    }


def sector_distribution(db: Session, user_id: int, *, prices: dict[str, float] | None = None) -> list[dict]:
    syms = get_open_tickers(db, user_id)
    if prices is None:
        prices = asyncio.run(get_current_prices(db, syms, user_id=user_id)) if syms else {}
    hs = []
    for sym in syms:
        px, unavail = _resolved_price_and_unavailable(db, sym, prices)
        m = compute_ticker_metrics(db, sym, px, user_id, price_unavailable=unavail)
        if m["total_shares"] > 0:
            hs.append(m)

    d = get_last_trading_day()
    mb = manual_breakdown_usd_at_date(db, d, user_id)

    by_sec: dict[str, dict] = defaultdict(lambda: {"value": 0.0, "tickers": []})
    for m in hs:
        sec = m.get("sector") or "Otros"
        by_sec[sec]["value"] += m["current_value"]
        by_sec[sec]["tickers"].append(m["ticker"])

    if mb["fondos_usd_equiv"] > 0:
        by_sec["Fondos (CLP)"]["value"] += mb["fondos_usd_equiv"]
    if mb["afp_usd_equiv"] > 0:
        by_sec["AFP (CLP)"]["value"] += mb["afp_usd_equiv"]
    if mb["manuales_usd"] > 0:
        by_sec["Activos manuales (USD)"]["value"] += mb["manuales_usd"]

    total = sum(x["value"] for x in by_sec.values())
    slices = []
    for sec, data in sorted(by_sec.items(), key=lambda x: -x[1]["value"]):
        pct = (data["value"] / total * 100.0) if total > 0 else 0.0
        tickers = sorted(data["tickers"]) if data["tickers"] else []
        slices.append(
            {
                "sector": sec,
                "pct": pct,
                "value": data["value"],
                "tickers": tickers,
            }
        )
    return slices
