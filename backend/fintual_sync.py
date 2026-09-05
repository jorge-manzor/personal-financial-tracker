"""
Sincroniza posiciones, movimientos de acciones, billetera USD y precios desde Fintual hacia la DB local.
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import and_, delete, func, or_
from sqlalchemy.orm import Session

from fintual_client import (
    DEFAULT_HIST_START,
    fintual_configured,
    fetch_goal_movements_all_pages,
    fetch_wallet_graphql_all_pages,
    get_asset_details,
    get_buys_and_dividends,
    get_current_prices_raw,
    get_goals_rest,
    get_historical_prices_raw,
    get_sells,
    get_stock_positions_raw,
    refresh_pricing_jwt,
    sector_industry_for_symbol,
    use_fintual_credentials,
)
from models import FintualPosition, PriceCache, StockSplit, Transaction, User, WalletMovement
from stock_assets import upsert_stock_asset

logger = logging.getLogger(__name__)


def _parse_dt(s: str | None) -> datetime | None:
    """Parsea ISO8601 y devuelve datetime naive en UTC (ordenable y compatible con la DB)."""
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def normalize_wallet_events(data: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    d = data.get("data") or {}

    for div in d.get("stocksWalletDividends") or []:
        eid = div.get("id")
        events.append(
            {
                "external_key": f"DIVIDEND:{eid}",
                "event_type": "DIVIDEND",
                "occurred_at": _parse_dt(div.get("date")) or _parse_dt(div.get("createdAt")),
                "symbol": (div.get("asset") or {}).get("symbol"),
                "amount_usd": float(div["netCapital"]["amount"]) if div.get("netCapital") else None,
                "amount_clp": None,
                "exchange_rate": None,
            }
        )

    for dep in d.get("stocksDomesticBankDeposits") or []:
        forex = dep.get("forexOrder") or {}
        ts = _parse_dt(forex.get("executedAt")) or _parse_dt(dep.get("declaredAt"))
        cap = dep.get("capital") or {}
        fc = forex.get("foreignCapital") or {}
        events.append(
            {
                "external_key": f"DEPOSIT:{dep.get('id')}",
                "event_type": "DEPOSIT",
                "occurred_at": ts,
                "symbol": None,
                "amount_usd": float(fc["amount"]) if fc.get("amount") is not None else None,
                "amount_clp": float(cap["amount"]) if cap.get("amount") is not None else None,
                "exchange_rate": float(er["amount"])
                if (er := forex.get("exchangeRate")) and er.get("amount") is not None
                else None,
            }
        )

    for wit in d.get("stocksDomesticBankWithdrawals") or []:
        forex = wit.get("forexOrder") or {}
        ts = _parse_dt(forex.get("executedAt")) or _parse_dt(wit.get("declaredAt"))
        req = wit.get("requestedCapital") or {}
        dc = forex.get("domesticCapital") or {}
        events.append(
            {
                "external_key": f"WITHDRAWAL:{wit.get('id')}",
                "event_type": "WITHDRAWAL",
                "occurred_at": ts,
                "symbol": None,
                "amount_usd": float(req["amount"]) if req.get("amount") is not None else None,
                "amount_clp": float(dc["amount"]) if dc.get("amount") is not None else None,
                "exchange_rate": float(er["amount"])
                if (er := forex.get("exchangeRate")) and er.get("amount") is not None
                else None,
            }
        )

    for interest in d.get("stocksWalletCashInterests") or []:
        events.append(
            {
                "external_key": f"CASH_INTEREST:{interest.get('id')}",
                "event_type": "CASH_INTEREST",
                "occurred_at": _parse_dt(interest.get("date")) or _parse_dt(interest.get("createdAt")),
                "symbol": None,
                "amount_usd": float(interest["amount"]) if interest.get("amount") is not None else None,
                "amount_clp": None,
                "exchange_rate": None,
            }
        )

    for comp in d.get("stocksWalletCompensations") or []:
        cap = comp.get("capital") or {}
        events.append(
            {
                "external_key": f"COMPENSATION:{comp.get('id')}",
                "event_type": "COMPENSATION",
                "occurred_at": _parse_dt(comp.get("date")) or _parse_dt(comp.get("createdAt")),
                "symbol": None,
                "amount_usd": float(cap["amount"]) if cap.get("amount") is not None else None,
                "amount_clp": None,
                "exchange_rate": None,
            }
        )

    for merger in d.get("stocksWalletCashMergers") or []:
        cap = merger.get("capital") or {}
        sym = (merger.get("asset") or {}).get("symbol")
        events.append(
            {
                "external_key": f"CASH_MERGER:{merger.get('id')}",
                "event_type": "CASH_MERGER",
                "occurred_at": _parse_dt(merger.get("date")) or _parse_dt(merger.get("createdAt")),
                "symbol": sym,
                "amount_usd": float(cap["amount"]) if cap.get("amount") is not None else None,
                "amount_clp": None,
                "exchange_rate": None,
            }
        )

    # stocksWalletAssetSubscriptionInstructions / RedemptionInstructions: no se persisten como
    # WalletMovement — las compras/ventas vienen de Transaction (sync por símbolo); la wallet
    # solo aporta descubrimiento de tickers históricos (wallet_stock_symbols_from_raw).

    for dive in d.get("stocksDivestments") or []:
        uid = str(dive.get("divestmentOperationUuid") or dive.get("declaredAt") or "")
        cc = (dive.get("convertedCurrency") or "").upper()
        rc = (dive.get("requestedCurrency") or "").upper()
        amt: float | None = None
        try:
            if cc == "USD" and dive.get("convertedAmount") is not None:
                amt = float(dive["convertedAmount"])
            elif rc == "USD" and dive.get("requestedAmount") is not None:
                amt = float(dive["requestedAmount"])
            elif dive.get("convertedAmount") is not None:
                amt = float(dive["convertedAmount"])
            elif dive.get("requestedAmount") is not None:
                amt = float(dive["requestedAmount"])
        except (TypeError, ValueError):
            amt = None
        ts = (
            _parse_dt(dive.get("paidAt"))
            or _parse_dt(dive.get("executedAt"))
            or _parse_dt(dive.get("declaredAt"))
        )
        events.append(
            {
                "external_key": f"DIVESTMENT:{uid}",
                "event_type": "DIVESTMENT",
                "occurred_at": ts,
                "symbol": None,
                "amount_usd": amt,
                "amount_clp": None,
                "exchange_rate": None,
            }
        )

    acat_raw = d.get("stocksWalletAcatCashActivities")
    acats: list[dict[str, Any]] = []
    if isinstance(acat_raw, list):
        acats = [x for x in acat_raw if isinstance(x, dict)]
    elif isinstance(acat_raw, dict):
        acats = [acat_raw]
    for acat in acats:
        for item in acat.get("cashInbounds") or []:
            eid = item.get("id")
            events.append(
                {
                    "external_key": f"ACAT_CASH_INBOUND:{eid}",
                    "event_type": "ACAT_CASH_INBOUND",
                    "occurred_at": _parse_dt(item.get("createdAt")) or _parse_dt(item.get("date")),
                    "symbol": None,
                    "amount_usd": float(item["amount"]) if item.get("amount") is not None else None,
                    "amount_clp": None,
                    "exchange_rate": None,
                }
            )
        for item in acat.get("fees") or []:
            eid = item.get("id")
            events.append(
                {
                    "external_key": f"ACAT_CASH_FEE:{eid}",
                    "event_type": "ACAT_CASH_FEE",
                    "occurred_at": _parse_dt(item.get("createdAt")) or _parse_dt(item.get("date")),
                    "symbol": None,
                    "amount_usd": float(item["amount"]) if item.get("amount") is not None else None,
                    "amount_clp": None,
                    "exchange_rate": None,
                }
            )
        for item in acat.get("cashOutbounds") or []:
            eid = item.get("id")
            events.append(
                {
                    "external_key": f"ACAT_CASH_OUTBOUND:{eid}",
                    "event_type": "ACAT_CASH_OUTBOUND",
                    "occurred_at": _parse_dt(item.get("createdAt")) or _parse_dt(item.get("date")),
                    "symbol": None,
                    "amount_usd": float(item["amount"]) if item.get("amount") is not None else None,
                    "amount_clp": None,
                    "exchange_rate": None,
                }
            )

    warr_raw = d.get("stocksWalletWarrantExerciseCashActivities")
    wacts: list[dict[str, Any]] = []
    if isinstance(warr_raw, list):
        wacts = [x for x in warr_raw if isinstance(x, dict)]
    elif isinstance(warr_raw, dict):
        wacts = [warr_raw]
    for wact in wacts:
        for item in wact.get("fees") or []:
            eid = item.get("id")
            events.append(
                {
                    "external_key": f"WARRANT_FEE:{eid}",
                    "event_type": "WARRANT_FEE",
                    "occurred_at": _parse_dt(item.get("createdAt")) or _parse_dt(item.get("date")),
                    "symbol": None,
                    "amount_usd": float(item["amount"]) if item.get("amount") is not None else None,
                    "amount_clp": None,
                    "exchange_rate": None,
                }
            )
        for item in wact.get("costs") or []:
            eid = item.get("id")
            events.append(
                {
                    "external_key": f"WARRANT_COST:{eid}",
                    "event_type": "WARRANT_COST",
                    "occurred_at": _parse_dt(item.get("createdAt")) or _parse_dt(item.get("date")),
                    "symbol": None,
                    "amount_usd": float(item["amount"]) if item.get("amount") is not None else None,
                    "amount_clp": None,
                    "exchange_rate": None,
                }
            )

    events = [e for e in events if e.get("occurred_at") is not None]
    events.sort(key=lambda x: x["occurred_at"], reverse=True)
    return events


def wallet_stock_symbols_from_raw(body: dict[str, Any]) -> set[str]:
    """
    Símbolos que aparecen en la wallet (compras/ventas vía wallet, dividendos, mergers en caja).
    Incluye activos ya vendidos que no están en posiciones actuales.
    """
    d = body.get("data") if isinstance(body.get("data"), dict) else body
    if not isinstance(d, dict):
        return set()
    symbols: set[str] = set()
    for item in d.get("stocksWalletAssetSubscriptionInstructions") or []:
        sym = ((item.get("assetOrder") or {}).get("asset") or {}).get("symbol")
        if sym:
            symbols.add(sym.upper().strip())
    for item in d.get("stocksWalletAssetRedemptionInstructions") or []:
        sym = ((item.get("assetOrder") or {}).get("asset") or {}).get("symbol")
        if sym:
            symbols.add(sym.upper().strip())
    for item in d.get("stocksWalletDividends") or []:
        sym = (item.get("asset") or {}).get("symbol")
        if sym:
            symbols.add(sym.upper().strip())
    for item in d.get("stocksWalletCashMergers") or []:
        sym = (item.get("asset") or {}).get("symbol")
        if sym:
            symbols.add(sym.upper().strip())
    return {s for s in symbols if s}


def _fetch_asset_details_safe(sym: str, fallback_id: str) -> dict[str, Any]:
    try:
        return get_asset_details(sym)
    except Exception as exc:
        logger.warning("detalle asset %s: %s", sym, exc)
        return {"id": fallback_id, "name": sym, "symbol": sym}


def _fetch_asset_details_in_thread(
    sym: str,
    fallback_id: str,
    session_cookie: str | None,
    uid: str | None,
) -> dict[str, Any]:
    """
    `ContextVar` de `use_fintual_credentials` no se hereda en ThreadPoolExecutor; hay que re-aplicar credenciales en el worker.
    """
    with use_fintual_credentials(session_cookie, uid):
        return _fetch_asset_details_safe(sym, fallback_id)


def _fetch_symbol_movements_in_thread(
    sym: str,
    session_cookie: str | None,
    uid: str | None,
) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]] | None, Exception | None]:
    with use_fintual_credentials(session_cookie, uid):
        return _fetch_symbol_movements(sym)


def _fetch_goal_movements_in_thread(
    gid: str,
    session_cookie: str | None,
    uid: str | None,
) -> tuple[str, list[dict[str, Any]] | None, Exception | None]:
    with use_fintual_credentials(session_cookie, uid):
        try:
            return gid, fetch_goal_movements_all_pages(gid), None
        except Exception as exc:
            return gid, None, exc


def _fetch_stock_asset_details_in_thread(
    sym: str,
    session_cookie: str | None,
    uid: str | None,
) -> tuple[str, dict[str, Any] | None, Exception | None]:
    with use_fintual_credentials(session_cookie, uid):
        try:
            return sym, get_asset_details(sym), None
        except Exception as exc:
            return sym, None, exc


def sync_positions(db: Session, user_id: int) -> int:
    u_row = db.query(User).filter(User.id == user_id).first()
    fs = ((u_row.fintual_session or "").strip() if u_row else "") or None
    fu = ((u_row.fintual_uid or "").strip() if u_row else "") or None

    raw = get_stock_positions_raw()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    seen: set[str] = set()
    rows: list[tuple[dict[str, Any], str, float]] = []
    for p in raw:
        asset = p.get("asset") or {}
        sym = (asset.get("symbol") or "").upper().strip()
        if not sym:
            continue
        seen.add(sym)
        try:
            shares = float(p.get("shares") or 0.0)
        except (TypeError, ValueError):
            shares = 0.0
        rows.append((p, sym, shares))

    details_by_sym: dict[str, dict[str, Any]] = {}
    if rows:
        n_workers = min(10, len(rows))
        with ThreadPoolExecutor(max_workers=n_workers) as ex:
            futs = {
                ex.submit(_fetch_asset_details_in_thread, sym, str(p.get("id", "")), fs, fu): sym
                for p, sym, _ in rows
            }
            for fut in as_completed(futs):
                sym = futs[fut]
                try:
                    details_by_sym[sym] = fut.result()
                except Exception as exc:
                    logger.warning("detalle asset %s: %s", sym, exc)
                    details_by_sym[sym] = {"id": "", "name": sym, "symbol": sym}

    n = 0
    for p, sym, shares in rows:
        details = details_by_sym.get(sym) or {"id": str(p.get("id", "")), "name": sym, "symbol": sym}
        sec, ind = sector_industry_for_symbol(sym)
        fid = str(details.get("id") or p.get("id") or "")
        name = (details.get("name") or sym).strip()
        row = (
            db.query(FintualPosition)
            .filter(FintualPosition.user_id == user_id, FintualPosition.symbol == sym)
            .first()
        )
        if row:
            row.name = name
            row.fintual_asset_id = fid
            row.shares = shares
            row.sector = sec
            row.industry = ind
            row.updated_at = now
        else:
            db.add(
                FintualPosition(
                    user_id=user_id,
                    symbol=sym,
                    name=name,
                    fintual_asset_id=fid,
                    shares=shares,
                    sector=sec,
                    industry=ind,
                    updated_at=now,
                )
            )
        upsert_stock_asset(db, sym, name, fintual_asset_id=fid or None)
        n += 1

    for row in db.query(FintualPosition).filter(FintualPosition.user_id == user_id).all():
        if row.symbol not in seen:
            db.delete(row)

    db.commit()
    return n


def _fetch_symbol_movements(sym: str) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]] | None, Exception | None]:
    """
    Descarga compras/dividendos y ventas en paralelo por símbolo.
    Las ventas no usan query de detalle por ID (evita 1 HTTP por venta).
    """
    try:
        pack = get_buys_and_dividends(sym)
        sells = get_sells(sym, enrich=False)
        return sym, pack, sells, None
    except Exception as exc:
        return sym, None, None, exc


def _parse_iso_date(s: str | None) -> date | None:
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).date()
    except ValueError:
        return None


def _shares_exact_str(n: float) -> str:
    """Representación sin ceros finales innecesarios (misma idea que la UI `formatSharesExact`)."""
    if not math.isfinite(n):
        return "0"
    s = f"{n:.16f}".rstrip("0").rstrip(".")
    return s if s else "0"


def _replace_stock_splits(db: Session, sym: str, splits: list[dict[str, Any]], user_id: int) -> None:
    su = sym.upper().strip()
    db.query(StockSplit).filter(StockSplit.user_id == user_id, StockSplit.symbol == su).delete()
    for s in splits or []:
        sid = str(s.get("id") or "").strip()
        fd = _parse_iso_date(s.get("date"))
        try:
            rate = float(s.get("rate") or 0.0)
        except (TypeError, ValueError):
            continue
        if not sid or fd is None or rate <= 0:
            continue
        db.add(
            StockSplit(user_id=user_id, symbol=su, split_date=fd, rate=rate, fintual_id=sid)
        )


def _split_display_rows_for_symbol(
    sym: str,
    sym_rows: list[dict[str, Any]],
    splits_raw: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Filas `division_accion` para la lista: precio_unitario = acciones antes, acciones = acciones después.
    Replay alineado con `portfolio_metrics._replay_symbol_usd` (split a 00:00 del día, luego txs).
    """
    splits_parsed: list[tuple[date, float, str]] = []
    for s in splits_raw or []:
        sid = str(s.get("id") or "").strip()
        fd = _parse_iso_date(s.get("date"))
        try:
            rate = float(s.get("rate") or 0.0)
        except (TypeError, ValueError):
            continue
        if not sid or fd is None or rate <= 0:
            continue
        splits_parsed.append((fd, rate, sid))
    splits_parsed.sort(key=lambda x: (x[0], x[2]))

    sym_sorted = sorted(sym_rows, key=lambda r: (r["_sort_at"], r["external_id"]))

    events: list[tuple[datetime, int, str, Any]] = []
    for fd, rate, sid in splits_parsed:
        events.append((datetime.combine(fd, time(0, 0, 0)), 0, sid, ("split", fd, rate, sid)))
    for r in sym_sorted:
        events.append((r["_sort_at"], 1, r["external_id"], ("tx", r)))
    events.sort(key=lambda x: (x[0], x[1], x[2]))

    sh = 0.0
    out: list[dict[str, Any]] = []
    for _, _, _, payload in events:
        if payload[0] == "split":
            _, fd, rate, sid = payload
            before = sh
            if before > 1e-18:
                sh *= rate
            else:
                sh = 0.0
            after = sh
            na = f"×{_shares_exact_str(rate)} · {_shares_exact_str(before)} → {_shares_exact_str(after)}"
            out.append(
                {
                    "_sort_at": datetime.combine(fd, time(0, 0, 0)),
                    "external_id": f"fintual:split:{sid}",
                    "fecha": fd,
                    "tipo": "division_accion",
                    "activo": sym,
                    "acciones": after,
                    "precio_unitario": before,
                    "monto_total": 0.0,
                    "categoria": "División Acción",
                    "currency": "USD",
                    "nombre_activo": na,
                }
            )
        else:
            _, r = payload
            tipo = (r.get("tipo") or "").lower()
            if tipo in ("compra", "reinversion"):
                sh += float(r["acciones"])
            elif tipo == "venta":
                sh -= float(r["acciones"])
                if sh < 1e-12:
                    sh = 0.0
    return out


def _buy_sort_ts(buy: dict[str, Any]) -> datetime:
    ao = buy.get("assetOrder") or {}
    dt = _parse_dt(ao.get("fulfilledAt")) or _parse_dt(buy.get("declaredAt"))
    if dt:
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    return datetime(1970, 1, 1)


def _sell_sort_ts(sell: dict[str, Any]) -> datetime:
    ao = sell.get("assetOrder") or {}
    dt = _parse_dt(ao.get("fulfilledAt")) or _parse_dt(sell.get("declaredAt"))
    if dt:
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    return datetime(1970, 1, 1)


def _collect_symbols(db: Session, position_symbols: list[str], user_id: int) -> list[str]:
    prev = (
        db.query(Transaction.activo)
        .filter(
            Transaction.user_id == user_id,
            Transaction.source == "fintual",
            Transaction.categoria == "Acciones",
        )
        .distinct()
        .all()
    )
    s = {x.upper().strip() for x in position_symbols if x}
    s |= {r[0].upper().strip() for r in prev if r[0]}
    return sorted(s)


def sync_fintual_stock_transactions(db: Session, symbols: list[str], user_id: int) -> int:
    """
    Reemplaza movimientos de acciones desde Fintual (compras, ventas, divs, divisiones), símbolo por símbolo.

    Solo se borra y reemplaza el historial de un ticker si su fetch a Fintual fue exitoso: si falla
    (p. ej. límite de la API GraphQL, timeout), sus transacciones existentes se dejan intactas en vez
    de perderse — antes se borraba todo el historial de Acciones al inicio y solo se reinsertaba lo que
    sí se pudo traer, así que cualquier falla parcial vaciaba el historial de los tickers que fallaron.
    """
    u_row = db.query(User).filter(User.id == user_id).first()
    fs = ((u_row.fintual_session or "").strip() if u_row else "") or None
    fu = ((u_row.fintual_uid or "").strip() if u_row else "") or None

    pending: list[dict[str, Any]] = []

    fetched: list[tuple[str, dict[str, Any], list[dict[str, Any]]]] = []
    if symbols:
        workers = min(10, len(symbols))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_fetch_symbol_movements_in_thread, s, fs, fu): s for s in symbols}
            for fut in as_completed(futs):
                sym, pack, sells, err = fut.result()
                if err is not None:
                    logger.warning("movimientos %s: %s", sym, err)
                    continue
                if pack is not None:
                    fetched.append((sym, pack, sells or []))

    fetched_symbols = [sym for sym, _, _ in fetched]
    if fetched_symbols:
        # Sin commit aquí a propósito: el borrado debe quedar en la misma transacción que el
        # reinsert de más abajo (único db.commit() de la función), para que ambos se apliquen
        # juntos o ninguno lo haga si algo falla entremedio (p. ej. get_asset_details).
        db.execute(
            delete(Transaction).where(
                and_(
                    Transaction.user_id == user_id,
                    Transaction.source == "fintual",
                    Transaction.activo.in_(fetched_symbols),
                    or_(
                        Transaction.categoria == "Acciones",
                        Transaction.categoria == "División Acción",
                    ),
                )
            )
        )

    asset_details: dict[str, dict[str, Any]] = {}
    if fintual_configured() and fetched:
        workers = min(10, len(fetched))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {
                ex.submit(_fetch_stock_asset_details_in_thread, sym, fs, fu): sym for sym, _, _ in fetched
            }
            for fut in as_completed(futs):
                sym, ad, err = fut.result()
                if err is not None:
                    logger.debug("get_asset_details(%s): %s", sym, err)
                    continue
                if ad is not None:
                    asset_details[sym] = ad

    for sym, pack, sells in fetched:
        ad = asset_details.get(sym)
        asset_display_name: str | None = None
        if ad is not None:
            asset_display_name = (ad.get("name") or "").strip() or None
            upsert_stock_asset(
                db,
                sym,
                asset_display_name or "",
                fintual_asset_id=str(ad.get("id") or "") or None,
            )

        reinvest_ids = pack.get("reinvested_dividend_ids") or set()
        manual = pack.get("manual_buys") or []
        reinvested = pack.get("reinvested_dividends") or []
        reinvest_buy_ids = {str(b.get("id")) for b in reinvested if b.get("id")}
        sym_rows: list[dict[str, Any]] = []

        for buy in manual + reinvested:
            ao = buy.get("assetOrder") or {}
            if (ao.get("state") or "") != "fulfilled":
                continue
            try:
                shares = float(ao.get("shares") or 0.0)
                avg = float((ao.get("averagePrice") or {}).get("amount") or 0.0)
                cap = float((ao.get("capital") or {}).get("amount") or 0.0)
            except (TypeError, ValueError):
                continue
            if shares <= 0 or cap <= 0:
                continue
            bid = str(buy.get("id", ""))
            fd = _parse_iso_date(ao.get("fulfilledAt")) or _parse_iso_date(buy.get("declaredAt"))
            if not fd:
                continue
            is_reinv = str(buy.get("id")) in reinvest_buy_ids
            sym_rows.append(
                {
                    "_sort_at": _buy_sort_ts(buy),
                    "external_id": f"fintual:buy:{bid}",
                    "fecha": fd,
                    "tipo": "reinversion" if is_reinv else "compra",
                    "activo": sym,
                    "acciones": shares,
                    "precio_unitario": avg if avg > 0 else cap / shares,
                    "monto_total": cap,
                    "categoria": "Acciones",
                    "currency": "USD",
                    "nombre_activo": asset_display_name,
                }
            )

        for sell in sells:
            ao = sell.get("assetOrder") or {}
            if (ao.get("state") or "") != "fulfilled":
                continue
            try:
                shares = float(ao.get("shares") or 0.0)
                ap = ao.get("averagePrice") or {}
                avg = float(ap.get("amount") or 0.0) if ap else 0.0
                cap = float((ao.get("capital") or {}).get("amount") or 0.0)
            except (TypeError, ValueError):
                continue
            if shares <= 0 or cap <= 0:
                continue
            sid = str(sell.get("id", ""))
            fd = _parse_iso_date(ao.get("fulfilledAt")) or _parse_iso_date(sell.get("declaredAt"))
            if not fd:
                continue
            sym_rows.append(
                {
                    "_sort_at": _sell_sort_ts(sell),
                    "external_id": f"fintual:sell:{sid}",
                    "fecha": fd,
                    "tipo": "venta",
                    "activo": sym,
                    "acciones": shares,
                    "precio_unitario": avg if avg > 0 else cap / shares,
                    "monto_total": cap,
                    "categoria": "Acciones",
                    "currency": "USD",
                    "nombre_activo": asset_display_name,
                }
            )

        for div in pack.get("received_dividends") or []:
            did = str(div.get("id", ""))
            if did in reinvest_ids:
                continue
            try:
                amt = float((div.get("netCapital") or {}).get("amount") or 0.0)
            except (TypeError, ValueError):
                continue
            if amt <= 0:
                continue
            fd = _parse_iso_date(div.get("date"))
            if not fd:
                continue
            div_dt = _parse_dt(div.get("date")) or datetime.combine(fd, datetime.min.time())
            sym_rows.append(
                {
                    "_sort_at": div_dt.replace(tzinfo=None) if div_dt.tzinfo else div_dt,
                    "external_id": f"fintual:div:{did}",
                    "fecha": fd,
                    "tipo": "dividendo",
                    "activo": sym,
                    "acciones": 0.0,
                    "precio_unitario": 0.0,
                    "monto_total": amt,
                    "categoria": "Acciones",
                    "currency": "USD",
                    "nombre_activo": asset_display_name or "Dividendo en efectivo",
                }
            )

        pending.extend(sym_rows)
        pending.extend(_split_display_rows_for_symbol(sym, sym_rows, pack.get("splits") or []))
        _replace_stock_splits(db, sym, pack.get("splits") or [], user_id)

    pending.sort(key=lambda r: (r["_sort_at"], r["external_id"]))

    for row in pending:
        sort_at = row.pop("_sort_at")
        ext = row.pop("external_id")
        db.add(
            Transaction(
                user_id=user_id,
                fecha=row["fecha"],
                tipo=row["tipo"],
                activo=row["activo"],
                acciones=row["acciones"],
                precio_unitario=row["precio_unitario"],
                monto_total=row["monto_total"],
                categoria=row["categoria"],
                currency=row["currency"],
                nombre_activo=row.get("nombre_activo"),
                source="fintual",
                external_id=ext,
                occurred_at=sort_at,
            )
        )
    db.commit()
    return len(pending)


_GOAL_DEPOSIT_WITHDRAW_TYPES = frozenset(
    {
        "Walle::UserDeposit",
        "Walle::UnrestrictedWithdrawal",
    }
)


def sync_fintual_goal_transactions(db: Session, user_id: int) -> int:
    """Depósitos y retiros en CLP de fondos/metas Fintual (`categoria=Fondos`, nombre = meta)."""
    if not fintual_configured():
        return 0

    db.execute(
        delete(Transaction).where(
            and_(
                Transaction.user_id == user_id,
                Transaction.source == "fintual",
                Transaction.categoria == "Fondos",
            )
        )
    )
    db.commit()

    try:
        goals_raw = get_goals_rest()
    except Exception as exc:
        logger.warning("Fintual GET /api/goals/: %s", exc)
        return 0

    u_row = db.query(User).filter(User.id == user_id).first()
    fs = ((u_row.fintual_session or "").strip() if u_row else "") or None
    fu = ((u_row.fintual_uid or "").strip() if u_row else "") or None

    goal_names: dict[str, str] = {}
    goal_ids: list[str] = []
    for g in goals_raw:
        gid = str(g.get("id", "")).strip()
        if not gid:
            continue
        attr = g.get("attributes") or {}
        goal_names[gid] = (attr.get("name") or "").strip() or f"Meta {gid}"
        goal_ids.append(gid)

    fetched_goals: list[tuple[str, list[dict[str, Any]]]] = []
    if goal_ids:
        workers = min(10, len(goal_ids))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {
                ex.submit(_fetch_goal_movements_in_thread, gid, fs, fu): gid for gid in goal_ids
            }
            for fut in as_completed(futs):
                gid, movements, err = fut.result()
                if err is not None:
                    logger.warning("goal movements %s: %s", gid, err)
                    continue
                if movements is not None:
                    fetched_goals.append((gid, movements))

    pending: list[dict[str, Any]] = []
    for gid, movements in fetched_goals:
        name = goal_names[gid]
        for m in movements:
            mtype = (m.get("type") or "").strip()
            if mtype not in _GOAL_DEPOSIT_WITHDRAW_TYPES:
                continue
            mid = str(m.get("id", "")).strip()
            if not mid:
                continue
            try:
                amt = abs(float(m.get("amount") or 0.0))
            except (TypeError, ValueError):
                continue
            if amt <= 1e-9:
                continue
            tipo = "deposito" if mtype == "Walle::UserDeposit" else "retiro"
            dt = _parse_dt(m.get("fulfilledAt")) or _parse_dt(m.get("declaredAt"))
            if not dt:
                continue
            fd = dt.date()
            sort_at = dt.replace(tzinfo=None) if dt.tzinfo else dt
            pending.append(
                {
                    "_sort_at": sort_at,
                    "external_id": f"fintual:goal:{gid}:{mid}",
                    "fecha": fd,
                    "tipo": tipo,
                    "activo": gid,
                    "acciones": 0.0,
                    "precio_unitario": 0.0,
                    "monto_total": amt,
                    "categoria": "Fondos",
                    "currency": "CLP",
                    "nombre_activo": name,
                }
            )

    pending.sort(key=lambda r: (r["_sort_at"], r["external_id"]))

    for row in pending:
        sort_at = row.pop("_sort_at")
        ext = row.pop("external_id")
        db.add(
            Transaction(
                user_id=user_id,
                fecha=row["fecha"],
                tipo=row["tipo"],
                activo=row["activo"],
                acciones=row["acciones"],
                precio_unitario=row["precio_unitario"],
                monto_total=row["monto_total"],
                categoria=row["categoria"],
                currency=row["currency"],
                nombre_activo=row.get("nombre_activo"),
                source="fintual",
                external_id=ext,
                occurred_at=sort_at,
            )
        )
    db.commit()
    return len(pending)


def sync_wallet_movements(db: Session, user_id: int, wallet_raw: dict[str, Any] | None = None) -> int:
    raw = wallet_raw if wallet_raw is not None else fetch_wallet_graphql_all_pages()
    events = normalize_wallet_events(raw)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    n = 0
    for e in events:
        key = e["external_key"]
        row = (
            db.query(WalletMovement)
            .filter(WalletMovement.user_id == user_id, WalletMovement.external_key == key)
            .first()
        )
        oc = e["occurred_at"]
        if oc.tzinfo is not None:
            oc = oc.replace(tzinfo=None)
        sym = e.get("symbol")
        if sym:
            sym = str(sym).upper().strip()
        if row:
            row.event_type = e["event_type"]
            row.occurred_at = oc
            row.symbol = sym
            row.amount_usd = e.get("amount_usd")
            row.amount_clp = e.get("amount_clp")
            row.exchange_rate = e.get("exchange_rate")
            row.updated_at = now
        else:
            db.add(
                WalletMovement(
                    user_id=user_id,
                    external_key=key,
                    event_type=e["event_type"],
                    occurred_at=oc,
                    symbol=sym,
                    amount_usd=e.get("amount_usd"),
                    amount_clp=e.get("amount_clp"),
                    exchange_rate=e.get("exchange_rate"),
                    updated_at=now,
                )
            )
        n += 1
    db.commit()
    return n


def _upsert_prices(db: Session, symbol: str, prices: list[dict]) -> int:
    sym = symbol.upper().strip()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    count = 0
    for p in prices:
        try:
            price = float(p["price"])
            t = p.get("time") or ""
            day = date.fromisoformat(t[:10])
        except (KeyError, TypeError, ValueError):
            continue
        row = db.query(PriceCache).filter(PriceCache.ticker == sym, PriceCache.date == day).first()
        if row:
            row.close_price = price
            row.fetched_at = now
        else:
            db.add(
                PriceCache(
                    ticker=sym,
                    date=day,
                    close_price=price,
                    fetched_at=now,
                )
            )
        count += 1
    try:
        db.commit()
    except Exception as exc:
        logger.warning("price_cache commit %s: %s", sym, exc)
        db.rollback()
    return count


def _first_event_date_for_symbol(db: Session, symbol: str, user_id: int) -> date | None:
    sym = symbol.upper().strip()
    r = (
        db.query(Transaction.fecha)
        .filter(
            Transaction.user_id == user_id,
            Transaction.source == "fintual",
            Transaction.activo == sym,
            Transaction.categoria == "Acciones",
        )
        .order_by(Transaction.fecha.asc())
        .first()
    )
    return r[0] if r else None


def _date_to_start_iso(d: date) -> str:
    return f"{d.isoformat()}T00:00:00Z"


def sync_historical_prices_for_symbol(
    db: Session,
    symbol: str,
    *,
    user_id: int,
    force: bool = False,
    start_date: date | None = None,
) -> int:
    sym = symbol.upper().strip()
    if force:
        db.query(PriceCache).filter(PriceCache.ticker == sym).delete()
        db.commit()

    fd = start_date or _first_event_date_for_symbol(db, sym, user_id)
    start_iso = _date_to_start_iso(fd) if fd else DEFAULT_HIST_START
    jwt = refresh_pricing_jwt()
    raw = get_historical_prices_raw(sym, start=start_iso, jwt=jwt)
    return _upsert_prices(db, sym, raw)


def sync_current_prices_batch(db: Session, symbols: list[str], _user_id: int) -> int:
    if not symbols:
        return 0
    try:
        rows = get_current_prices_raw(symbols)
    except Exception as exc:
        logger.warning("current prices: %s", exc)
        return 0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today = datetime.now().date()

    n = 0
    for p in rows:
        try:
            sym = str(p["symbol"]).upper().strip()
            price = float(p["price"])
        except (KeyError, TypeError, ValueError):
            continue
        row = db.query(PriceCache).filter(PriceCache.ticker == sym, PriceCache.date == today).first()
        if row:
            row.close_price = price
            row.fetched_at = now
        else:
            db.add(
                PriceCache(
                    ticker=sym,
                    date=today,
                    close_price=price,
                    fetched_at=now,
                )
            )
        n += 1
    try:
        db.commit()
    except Exception as exc:
        logger.warning("current price cache: %s", exc)
        db.rollback()
    return n


def _latest_price_cache_date(db: Session, symbol: str) -> date | None:
    sym = symbol.upper().strip()
    return db.query(func.max(PriceCache.date)).filter(PriceCache.ticker == sym).scalar()


def sync_all_fintual(db: Session, user_id: int, *, force_prices: bool = False) -> dict[str, int]:
    if not fintual_configured():
        logger.warning("Fintual no configurado (FINTUAL_SESSION / FINTUAL_UID)")
        return {"positions": 0, "wallet": 0, "stock_tx": 0, "goal_tx": 0, "price_rows": 0, "current_prices": 0}

    n_pos = sync_positions(db, user_id)
    pos_syms = [r.symbol for r in db.query(FintualPosition).filter(FintualPosition.user_id == user_id).all()]
    wallet_raw = fetch_wallet_graphql_all_pages()
    extra_syms = wallet_stock_symbols_from_raw(wallet_raw)
    base_syms = set(_collect_symbols(db, pos_syms, user_id))
    if extra_syms - base_syms:
        logger.info(
            "tickers en historial de wallet sin posición actual: %s",
            sorted(extra_syms - base_syms),
        )
    symbols = sorted(base_syms | extra_syms)
    n_tx = sync_fintual_stock_transactions(db, symbols, user_id) if symbols else 0
    n_goals = sync_fintual_goal_transactions(db, user_id)
    n_wm = sync_wallet_movements(db, user_id, wallet_raw=wallet_raw)

    from history import get_last_trading_day, get_tickers_from_transactions

    tickers = get_tickers_from_transactions(db, user_id)
    total_prices = 0
    last_td = get_last_trading_day()
    jwt = refresh_pricing_jwt()

    to_fetch: list[tuple[str, str]] = []
    for sym in tickers:
        if not force_prices:
            latest = _latest_price_cache_date(db, sym)
            if latest is not None and latest >= last_td:
                continue
        fd = _first_event_date_for_symbol(db, sym, user_id)
        start_iso = _date_to_start_iso(fd) if fd else DEFAULT_HIST_START
        if force_prices:
            db.query(PriceCache).filter(PriceCache.ticker == sym.upper()).delete()
            db.commit()
        to_fetch.append((sym, start_iso))

    if to_fetch:
        u_row = db.query(User).filter(User.id == user_id).first()
        fs = ((u_row.fintual_session or "").strip() if u_row else "") or None
        fu = ((u_row.fintual_uid or "").strip() if u_row else "") or None

        def _fetch_price_history_in_thread(sym: str, start_iso: str) -> list[dict[str, Any]]:
            with use_fintual_credentials(fs, fu):
                return get_historical_prices_raw(sym.upper(), start=start_iso, jwt=jwt)

        workers = min(10, len(to_fetch))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {
                ex.submit(_fetch_price_history_in_thread, sym, start_iso): sym
                for sym, start_iso in to_fetch
            }
            for fut in as_completed(futs):
                sym = futs[fut]
                try:
                    raw = fut.result()
                except Exception as e:
                    logger.warning("histórico Fintual %s: %s", sym, e)
                    continue
                total_prices += _upsert_prices(db, sym, raw)

    n_cur = sync_current_prices_batch(db, tickers, user_id)

    return {
        "positions": n_pos,
        "wallet": n_wm,
        "stock_tx": n_tx,
        "goal_tx": n_goals,
        "price_rows": total_prices,
        "current_prices": n_cur,
    }
