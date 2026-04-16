from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, delete, func
from sqlalchemy.orm import Session

from models import (
    FintualPosition,
    ManualAsset,
    ManualAssetHistory,
    PortfolioValueCache,
    PriceCache,
    StockSplit,
    Transaction,
    WalletMovement,
)

logger = logging.getLogger(__name__)


def transaction_occurred_at(tx: Transaction) -> datetime:
    """
    Instante para ordenar movimientos: timestamp de la API (Fintual) o fecha contable
    a mediodía cuando no hay hora (manual / legado).
    """
    oc = getattr(tx, "occurred_at", None)
    if oc is not None:
        if getattr(oc, "tzinfo", None) is not None:
            return oc.replace(tzinfo=None)
        return oc
    return datetime.combine(tx.fecha, time(12, 0, 0))


def get_last_trading_day(ref: date | None = None) -> date:
    """Last weekday on or before `ref` (approximation without exchange calendar)."""
    if ref is None:
        ref = datetime.now(timezone.utc).date()
    d = ref
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def trading_days_between(start: date, end: date) -> list[date]:
    """Weekdays from start to end inclusive."""
    days: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def first_trading_day_strictly_after(last: date, end: date) -> date | None:
    tds = trading_days_between(last + timedelta(days=1), end)
    return tds[0] if tds else None


def get_tickers_from_transactions(db: Session, user_id: int) -> list[str]:
    """Símbolos con historial de acciones USD (transacciones y/o posición abierta)."""
    rows = (
        db.query(Transaction.activo)
        .filter(
            Transaction.user_id == user_id,
            func.coalesce(Transaction.categoria, "Acciones") == "Acciones",
            func.coalesce(Transaction.currency, "USD") == "USD",
        )
        .distinct()
        .all()
    )
    syms = {r[0].upper().strip() for r in rows if r[0]}
    for p in (
        db.query(FintualPosition)
        .filter(FintualPosition.user_id == user_id, FintualPosition.shares > 1e-12)
        .all()
    ):
        if p.symbol:
            syms.add(p.symbol.upper().strip())
    return sorted(syms)


def get_first_transaction_date(db: Session, user_id: int) -> date | None:
    """Primera fecha relevante al portafolio (manual, Fintual, precios)."""
    candidates: list[date] = []
    r = db.query(func.min(Transaction.fecha)).filter(Transaction.user_id == user_id).scalar()
    if r:
        candidates.append(r)
    wm = (
        db.query(func.min(WalletMovement.occurred_at))
        .filter(WalletMovement.user_id == user_id)
        .scalar()
    )
    if wm:
        candidates.append(wm.date() if isinstance(wm, datetime) else wm)
    mh = (
        db.query(func.min(ManualAssetHistory.fecha))
        .join(ManualAsset, ManualAssetHistory.asset_id == ManualAsset.id)
        .filter(ManualAsset.user_id == user_id)
        .scalar()
    )
    if mh:
        candidates.append(mh)
    return min(candidates) if candidates else None


def get_last_cached_date(db: Session, user_id: int) -> date | None:
    row = (
        db.query(PortfolioValueCache.fecha)
        .filter(
            PortfolioValueCache.user_id == user_id,
            PortfolioValueCache.categoria == "total",
        )
        .order_by(PortfolioValueCache.fecha.desc())
        .first()
    )
    return row[0] if row else None


def delete_cache_from(db: Session, from_date: date, user_id: int) -> None:
    db.execute(
        delete(PortfolioValueCache).where(
            and_(
                PortfolioValueCache.user_id == user_id,
                PortfolioValueCache.fecha >= from_date,
            )
        )
    )
    db.commit()


def _interpolate_series(dates: list[date], vals: list[float], d: date) -> float:
    if not dates:
        return 0.0
    if d <= dates[0]:
        return vals[0]
    if d >= dates[-1]:
        return vals[-1]
    for i in range(len(dates) - 1):
        if dates[i] <= d <= dates[i + 1]:
            den = max((dates[i + 1] - dates[i]).days, 1)
            t = (d - dates[i]).days / den
            return float(vals[i] + t * (vals[i + 1] - vals[i]))
    return vals[-1]


def manual_breakdown_usd_at_date(db: Session, d: date, user_id: int) -> dict[str, float]:
    from exchange_service import get_rate_for_date

    rate = get_rate_for_date(db, d)
    fondos_clp = 0.0
    afp_clp = 0.0
    manuales_usd = 0.0
    for a in db.query(ManualAsset).filter(ManualAsset.user_id == user_id).all():
        hist = (
            db.query(ManualAssetHistory)
            .filter(ManualAssetHistory.asset_id == a.id)
            .order_by(ManualAssetHistory.fecha)
            .all()
        )
        if not hist:
            continue
        dates = [h.fecha for h in hist]
        vals = [float(h.valor) for h in hist]
        v = _interpolate_series(dates, vals, d)
        mon = (a.moneda or "USD").upper()
        cat = (a.categoria or "").lower()
        if mon == "CLP":
            if "afp" in cat:
                afp_clp += v
            else:
                fondos_clp += v
        else:
            manuales_usd += v
    return {
        "fondos_clp": fondos_clp,
        "fondos_usd_equiv": fondos_clp / rate if rate else 0.0,
        "afp_clp": afp_clp,
        "afp_usd_equiv": afp_clp / rate if rate else 0.0,
        "manuales_usd": manuales_usd,
        "exchange_rate_usd_clp": rate,
        "manual_total_usd": (fondos_clp + afp_clp) / rate + manuales_usd if rate else manuales_usd,
    }


def manual_value_usd_on_date(db: Session, d: date, user_id: int) -> float:
    b = manual_breakdown_usd_at_date(db, d, user_id)
    return float(b["manual_total_usd"])


def is_stock_transaction(tx: Transaction) -> bool:
    c = (tx.categoria or "Acciones").strip()
    cur = (tx.currency or "USD").strip()
    return c == "Acciones" and cur == "USD"


@dataclass
class FondosAfpSplitState:
    """Net capital aportado (USD) separado: Fondos vs AFP."""

    fondos_usd: float = 0.0
    afp_usd: float = 0.0

    def apply(self, tx: Transaction, db: Session) -> None:
        from exchange_service import get_rate_for_date

        c = (tx.categoria or "Acciones").strip()
        if c not in ("Fondos", "AFP"):
            return
        if tx.tipo not in ("compra", "venta"):
            return
        rate = get_rate_for_date(db, tx.fecha)
        if rate <= 0:
            rate = 950.0
        cur = (tx.currency or "CLP").strip().upper()
        monto = float(tx.monto_total)
        sign = 1.0 if tx.tipo == "compra" else -1.0
        if cur == "CLP":
            delta = sign * (monto / rate)
        else:
            delta = sign * monto
        if c == "Fondos":
            self.fondos_usd += delta
        else:
            self.afp_usd += delta


@dataclass
class _TickerReplay:
    shares: float = 0.0
    cost_basis: float = 0.0


@dataclass
class ReplayState:
    """Estado de acciones USD para valorización e invertido (cost basis remanente)."""

    by_symbol: dict[str, _TickerReplay] = field(default_factory=dict)

    def apply(self, tx: Transaction) -> None:
        if not is_stock_transaction(tx):
            return
        sym = (tx.activo or "").upper().strip()
        if not sym:
            return
        st = self.by_symbol.setdefault(sym, _TickerReplay())
        tipo = (tx.tipo or "").lower()
        if tipo in ("compra", "reinversion"):
            st.shares += float(tx.acciones)
            st.cost_basis += float(tx.monto_total)
        elif tipo == "venta":
            sh = float(tx.acciones)
            if st.shares > 1e-12:
                avg = st.cost_basis / st.shares
            else:
                avg = 0.0
            cost_sold = avg * sh
            st.shares -= sh
            st.cost_basis -= cost_sold
            if st.shares < 1e-9:
                st.shares = 0.0
                st.cost_basis = 0.0


def fondos_afp_invertido_usd_now(db: Session, user_id: int) -> float:
    """Neto aportado solo en categorías Fondos + AFP (USD); no incluye Acciones ni Wallet USD."""
    st = FondosAfpSplitState()
    for tx in sorted(
        db.query(Transaction).filter(Transaction.user_id == user_id).all(),
        key=lambda t: (transaction_occurred_at(t), t.id),
    ):
        st.apply(tx, db)
    return st.fondos_usd + st.afp_usd


def _load_close_prices_from_cache(
    db: Session,
    tickers: list[str],
    _replay_start: date,
    end: date,
) -> dict[str, dict[date, float]]:
    if not tickers:
        return {}
    rows = (
        db.query(PriceCache)
        .filter(
            PriceCache.ticker.in_([t.upper() for t in tickers]),
            PriceCache.date <= end,
        )
        .all()
    )
    out: dict[str, dict[date, float]] = defaultdict(dict)
    for r in rows:
        out[r.ticker.upper()][r.date] = float(r.close_price)
    return dict(out)


def _latest_close_by_ticker(db: Session, tickers: list[str]) -> dict[str, float]:
    """Most recent close per symbol (any date). Used when daily series is missing."""
    out: dict[str, float] = {}
    for raw in tickers:
        sym = raw.upper().strip()
        if not sym:
            continue
        row = (
            db.query(PriceCache)
            .filter(PriceCache.ticker == sym)
            .order_by(PriceCache.date.desc())
            .first()
        )
        if row is not None:
            out[sym] = float(row.close_price)
    return out


def _price_on_or_before(series: dict[date, float], d: date) -> float | None:
    if not series:
        return None
    best_d: date | None = None
    best_p: float | None = None
    for dt, px in series.items():
        if dt <= d and (best_d is None or dt > best_d):
            best_d = dt
            best_p = px
    return best_p


def _mark_to_market_price(series: dict[date, float], d: date) -> float | None:
    if not series:
        return None
    px = _price_on_or_before(series, d)
    if px is not None:
        return px
    earliest_d = min(series.keys())
    return series[earliest_d]


def _tx_by_date(db: Session, user_id: int) -> dict[date, list[Transaction]]:
    txs = sorted(
        db.query(Transaction).filter(Transaction.user_id == user_id).all(),
        key=lambda t: (transaction_occurred_at(t), t.id),
    )
    by_d: dict[date, list[Transaction]] = defaultdict(list)
    for tx in txs:
        by_d[tx.fecha].append(tx)
    return by_d


def compute_portfolio_history(db: Session, from_date: date, to_date: date, user_id: int) -> None:
    """
    Replay from first transaction through `to_date`, but only persist rows for
    dates >= from_date and <= to_date.
    """
    first_tx = get_first_transaction_date(db, user_id)
    replay_start = first_tx if first_tx else from_date
    replay_start = min(replay_start, from_date)

    tickers = get_tickers_from_transactions(db, user_id)
    trading_days = trading_days_between(replay_start, to_date)
    if not trading_days:
        return

    close_by_ticker = _load_close_prices_from_cache(db, tickers, replay_start, to_date)
    latest_close_by_ticker = _latest_close_by_ticker(db, tickers)
    tx_by_date = _tx_by_date(db, user_id)

    splits_by_date: dict[date, list[StockSplit]] = defaultdict(list)
    for sp in (
        db.query(StockSplit)
        .filter(StockSplit.user_id == user_id)
        .order_by(StockSplit.split_date, StockSplit.id)
        .all()
    ):
        splits_by_date[sp.split_date].append(sp)

    fondos_afp_state = FondosAfpSplitState()
    replay = ReplayState()
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    db.execute(
        delete(PortfolioValueCache).where(
            and_(
                PortfolioValueCache.user_id == user_id,
                PortfolioValueCache.fecha >= from_date,
                PortfolioValueCache.fecha <= to_date,
            )
        )
    )

    warned_flat_mt_m = set()

    for d in trading_days:
        for sp in splits_by_date.get(d, []):
            sym = (sp.symbol or "").upper().strip()
            if not sym:
                continue
            st = replay.by_symbol.setdefault(sym, _TickerReplay())
            rate = float(sp.rate)
            if rate > 0 and st.shares > 1e-12:
                st.shares *= rate
        for tx in tx_by_date.get(d, []):
            fondos_afp_state.apply(tx, db)
            replay.apply(tx)

        if d < from_date:
            continue

        acciones_valor = 0.0
        acciones_invertido = 0.0

        for sym, st in replay.by_symbol.items():
            if st.shares <= 1e-12:
                continue
            series = close_by_ticker.get(sym.upper(), {})
            px = _mark_to_market_price(series, d)
            if px is None:
                px = latest_close_by_ticker.get(sym.upper())
                if px is not None and not series:
                    su = sym.upper()
                    if su not in warned_flat_mt_m:
                        warned_flat_mt_m.add(su)
                        logger.warning(
                            "No daily prices in price_cache for %s — using latest close only for mark-to-market "
                            "(valor line will be flat until sync stores full daily history)",
                            sym,
                        )
            if px is not None:
                acciones_valor += st.shares * px
            acciones_invertido += st.cost_basis

        b = manual_breakdown_usd_at_date(db, d, user_id)
        fondos_valor = float(b["fondos_usd_equiv"])
        afp_valor = float(b["afp_usd_equiv"])
        manuales_valor = float(b["manuales_usd"])
        fondos_invertido = fondos_afp_state.fondos_usd
        afp_invertido = fondos_afp_state.afp_usd
        total_valor = acciones_valor + fondos_valor + afp_valor + manuales_valor
        total_invertido = acciones_invertido + fondos_invertido + afp_invertido

        for cat, valor, inv in (
            ("acciones", acciones_valor, acciones_invertido),
            ("fondos", fondos_valor, fondos_invertido),
            ("afp", afp_valor, afp_invertido),
            ("manuales", manuales_valor, 0.0),
            ("total", total_valor, total_invertido),
        ):
            db.add(
                PortfolioValueCache(
                    user_id=user_id,
                    fecha=d,
                    categoria=cat,
                    valor=float(valor),
                    invertido=float(inv),
                    last_computed=now,
                )
            )
    db.commit()


def ensure_cache(db: Session, user_id: int, force: bool = False) -> tuple[bool, date | None]:
    """Returns (did_compute, last_trading_day)."""
    last_td = get_last_trading_day()
    first_tx = get_first_transaction_date(db, user_id)
    has_manual = (
        db.query(ManualAssetHistory)
        .join(ManualAsset, ManualAssetHistory.asset_id == ManualAsset.id)
        .filter(ManualAsset.user_id == user_id)
        .first()
        is not None
    )
    if not first_tx and not has_manual:
        return False, last_td

    has_rows = (
        db.query(PortfolioValueCache.id).filter(PortfolioValueCache.user_id == user_id).first()
        is not None
    )
    has_fondos_cat = (
        db.query(PortfolioValueCache.id)
        .filter(
            PortfolioValueCache.user_id == user_id,
            PortfolioValueCache.categoria == "fondos",
        )
        .first()
        is not None
    )
    has_afp_cat = (
        db.query(PortfolioValueCache.id)
        .filter(
            PortfolioValueCache.user_id == user_id,
            PortfolioValueCache.categoria == "afp",
        )
        .first()
        is not None
    )
    if has_rows and (not has_fondos_cat or not has_afp_cat):
        db.execute(delete(PortfolioValueCache).where(PortfolioValueCache.user_id == user_id))
        db.commit()
        force = True

    last_cached = get_last_cached_date(db, user_id)

    if not force and last_cached and last_cached >= last_td:
        return False, last_td

    if not first_tx:
        start_compute = get_last_trading_day(last_td - timedelta(days=365))
    else:
        start_compute = first_tx

    if force:
        db.execute(delete(PortfolioValueCache).where(PortfolioValueCache.user_id == user_id))
        db.commit()
        from_d = start_compute
        compute_portfolio_history(db, from_d, last_td, user_id)
        return True, last_td

    if last_cached is None:
        from_d = start_compute
        delete_cache_from(db, from_d, user_id)
    else:
        nxt = first_trading_day_strictly_after(last_cached, last_td)
        if nxt is None or nxt > last_td:
            return False, last_td
        from_d = nxt
        delete_cache_from(db, from_d, user_id)

    compute_portfolio_history(db, from_d, last_td, user_id)
    return True, last_td


def recompute_from_transaction_date(db: Session, tx_fecha: date, user_id: int) -> None:
    last_td = get_last_trading_day()
    delete_cache_from(db, tx_fecha, user_id)
    compute_portfolio_history(db, tx_fecha, last_td, user_id)


def full_recompute(db: Session, user_id: int) -> None:
    first_tx = get_first_transaction_date(db, user_id)
    last_td = get_last_trading_day()
    has_m = (
        db.query(ManualAssetHistory)
        .join(ManualAsset, ManualAssetHistory.asset_id == ManualAsset.id)
        .filter(ManualAsset.user_id == user_id)
        .first()
    )
    if not first_tx and not has_m:
        return
    start = first_tx or last_td
    db.execute(delete(PortfolioValueCache).where(PortfolioValueCache.user_id == user_id))
    db.commit()
    compute_portfolio_history(db, start, last_td, user_id)


def cache_needs_sync(db: Session, user_id: int) -> bool:
    last_td = get_last_trading_day()
    last_cached = get_last_cached_date(db, user_id)
    if last_cached is None:
        return True
    return last_cached < last_td
