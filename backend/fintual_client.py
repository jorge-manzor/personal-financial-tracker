"""
Cliente HTTP hacia Fintual (fintual.cl): GraphQL con cookies de sesión, precios vía JWT.
Variables: FINTUAL_SESSION (cookie _fintual_session_cookie), FINTUAL_UID (cookie uid).
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

logger = logging.getLogger(__name__)

FINTUAL_GQL = "https://fintual.cl/gql/"
# Movimientos de metas/fondos (mismo host que el GQL principal; override con FINTUAL_GQL_GOALS si hiciera falta).
FINTUAL_GQL_GOALS = (os.environ.get("FINTUAL_GQL_GOALS") or "https://fintual.cl/gql/").strip()
FINTUAL_JWT_URL = "https://fintual.cl/auth/jwt"
FINTUAL_PRICING_HISTORICAL = "https://fintual.cl/stocks-pricing-cl/historical-prices"
FINTUAL_PRICING_CURRENT = "https://fintual.cl/stocks-pricing-cl/current-prices"

DEFAULT_HIST_START = "2020-01-01T00:00:00Z"
DEFAULT_TIMEFRAME = "1Day"
DEFAULT_LIMIT = 2000

DIVIDEND_MATCH_TOLERANCE = 0.05
DIVIDEND_MATCH_DAYS = 30

QUERY_TAILORMADE_EXCHANGE_RATE_USD_CLP = """
query StocksExchangeRateUsdToClp {
  getTailormadeExchangeRate(fromCurrency: "usd", toCurrency: "clp")
}
"""


QUERY_POSITIONS = """
query StocksPositions {
    stocksPositions {
        id
        shares
        asset { symbol }
    }
}
"""

QUERY_ASSET_DETAILS = """
query StocksAssetDetails($assetSymbol: String!) {
    stocksAsset(assetSymbol: $assetSymbol) {
        id
        name
        symbol
        overview
    }
}
"""

QUERY_BUYS_AND_DIVIDENDS = """
query StocksAssetMovements($assetSymbol: String, $limit: Int, $offset: Int) {
  stocksAssetMarketBuys(assetSymbol: $assetSymbol, limit: $limit, offset: $offset) {
    id
    declaredAt
    requestedCapital { amount currency }
    assetOrder {
      id
      capital { amount currency }
      fulfilledAt
      shares
      averagePrice { amount currency }
      state
    }
  }
  stocksAssetMovements(assetSymbol: $assetSymbol, limit: $limit, offset: $offset) {
    receivedDividends {
      id
      date
      netCapital { amount currency }
    }
    splits {
      id
      date
      rate
    }
  }
}
"""

QUERY_SELLS_LIST = """
query StocksAssetMovements($assetSymbol: String, $limit: Int, $offset: Int) {
  stocksAssetMarketSells(assetSymbol: $assetSymbol, limit: $limit, offset: $offset) {
    id
    declaredAt
    requestedShares
    requestedCapital { amount currency }
    assetOrder {
      id
      capital { amount currency }
      fulfilledAt
      shares
      state
    }
  }
}
"""

QUERY_SELL_DETAIL = """
query StocksAssetMarketSell($id: ID!) {
  stocksAssetMarketSell(id: $id) {
    id
    chargedCommission
    commissionBps
    declaredAt
    requestedShares
    requestedCapital { amount currency }
    assetOrder {
      id
      averagePrice { amount currency }
      capital { amount currency }
      fulfilledAt
      shares
      state
    }
  }
}
"""

WALLET_QUERY = """
query WalletMovements($limit: Int!, $offset: Int!) {
  stocksWalletDividends(limit: $limit, offset: $offset) {
    id
    date
    createdAt
    netCapital { amount currency }
    asset { id symbol }
  }
  stocksDomesticBankDeposits(limit: $limit, offset: $offset) {
    id
    capital { amount currency }
    declaredAt
    forexOrder {
      id
      executedAt
      exchangeRate { amount }
      domesticCapital { amount currency }
      foreignCapital { amount currency }
    }
  }
  stocksDomesticBankWithdrawals(limit: $limit, offset: $offset) {
    id
    paidAt
    declaredAt
    requestedCapital { amount currency }
    forexOrder {
      id
      executedAt
      exchangeRate { amount }
      domesticCapital { amount currency }
      foreignCapital { amount currency }
    }
  }
  stocksDivestments(limit: $limit, offset: $offset) {
    divestmentOperationUuid
    requestedAmount
    requestedCurrency
    convertedAmount
    convertedCurrency
    declaredAt
    executedAt
    paidAt
  }
  stocksWalletAssetSubscriptionInstructions(limit: $limit, offset: $offset) {
    id
    declaredAt
    requestedCapital { amount currency }
    assetOrder {
      id
      shares
      averagePrice { amount currency }
      capital { amount currency }
      fulfilledAt
      state
      asset { id name symbol }
    }
  }
  stocksWalletAssetRedemptionInstructions(limit: $limit, offset: $offset) {
    id
    declaredAt
    requestedCapital { amount currency }
    requestedShares
    assetOrder {
      id
      shares
      averagePrice { amount currency }
      capital { amount currency }
      fulfilledAt
      state
      asset { id name symbol }
    }
  }
  stocksWalletCashMergers(limit: $limit, offset: $offset) {
    id
    createdAt
    date
    asset { id name symbol }
    capital { amount currency }
  }
  stocksWalletCompensations(limit: $limit, offset: $offset) {
    id
    createdAt
    date
    capital { amount currency }
  }
  stocksWalletCashInterests(limit: $limit, offset: $offset) {
    id
    createdAt
    date
    amount
  }
  stocksWalletAcatCashActivities(limit: $limit, offset: $offset) {
    fees { id date createdAt amount }
    cashInbounds { id date createdAt amount }
    cashOutbounds { id date createdAt amount }
  }
  stocksWalletWarrantExerciseCashActivities(limit: $limit, offset: $offset) {
    id
    fees { id date amount createdAt }
    costs { id date amount createdAt }
  }
}
"""

_sector_map: dict[str, dict[str, str]] | None = None


def _sector_json_path() -> Path:
    return Path(__file__).resolve().parent / "data" / "stock-sector.json"


def load_sector_map() -> dict[str, dict[str, str]]:
    global _sector_map
    if _sector_map is not None:
        return _sector_map
    p = _sector_json_path()
    if not p.is_file():
        logger.warning("stock-sector.json no encontrado en %s", p)
        _sector_map = {}
        return _sector_map
    with p.open(encoding="utf-8") as f:
        raw = json.load(f)
    _sector_map = {k.upper(): v for k, v in raw.items()}
    return _sector_map


def sector_industry_for_symbol(symbol: str) -> tuple[str | None, str | None]:
    m = load_sector_map().get(symbol.upper().strip())
    if not m:
        return None, None
    return m.get("sector"), m.get("industry")


_fintual_override: ContextVar[tuple[str, str] | None] = ContextVar("_fintual_override", default=None)


def fintual_session() -> str:
    o = _fintual_override.get()
    if o is not None:
        return o[0]
    return (os.environ.get("FINTUAL_SESSION") or "").strip()


def fintual_uid() -> str:
    o = _fintual_override.get()
    if o is not None:
        return o[1]
    return (os.environ.get("FINTUAL_UID") or "").strip()


def fintual_configured() -> bool:
    """Hay cookie de sesión usable (y opcionalmente uid); basta la sesión para la mayoría de llamadas."""
    return bool(fintual_session())


@contextmanager
def use_fintual_credentials(session: str | None, uid: str | None):
    """
    Credenciales Fintual por usuario (DB). Si hay sesión en DB, se usa (uid puede ir vacío).
    Si no hay sesión en DB, no se cae a FINTUAL_* del entorno (evita mezclar cuentas en servidor multiusuario).
    """
    s = (session or "").strip()
    u = (uid or "").strip()
    if s:
        tok = _fintual_override.set((s, u))
        try:
            yield
        finally:
            _fintual_override.reset(tok)
    else:
        tok = _fintual_override.set(("", ""))
        try:
            yield
        finally:
            _fintual_override.reset(tok)


def _cookie_dict() -> dict[str, str]:
    return {
        "_fintual_session_cookie": fintual_session(),
        "uid": fintual_uid(),
    }


def _gql_headers() -> dict[str, str]:
    return {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Referer": "https://fintual.cl/f/stocks/",
        "Origin": "https://fintual.cl",
    }


def _post_gql(operation: str, variables: dict[str, Any], query: str) -> dict[str, Any]:
    with httpx.Client(headers=_gql_headers(), cookies=_cookie_dict(), timeout=60.0) as client:
        r = client.post(
            FINTUAL_GQL,
            json={"operationName": operation, "variables": variables, "query": query},
        )
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(f"[fintual/gql] {operation}: {body['errors']}")
    return body.get("data") or {}


def fetch_tailormade_exchange_rate_usd_to_clp() -> float:
    """
    USD/CLP según Fintual (`getTailormadeExchangeRate`).
    Requiere sesión válida (cookies / `use_fintual_credentials` / env `FINTUAL_SESSION`).
    """
    data = _post_gql("StocksExchangeRateUsdToClp", {}, QUERY_TAILORMADE_EXCHANGE_RATE_USD_CLP)
    val = data.get("getTailormadeExchangeRate")
    if val is None:
        raise RuntimeError("getTailormadeExchangeRate ausente en la respuesta")
    return float(val)


QUERY_GOAL_MOVEMENTS = """
query GoalMovementsActivity($goalId: ID!, $page: Int!, $pageSize: Int!) {
  goalMovementsActivity: clGoalMovementsActivity(goalId: $goalId, page: $page, pageSize: $pageSize) {
    pagination { totalRecords }
    standardizedPortfolioMovements {
      id
      declaredAt
      amount
      type
      cashFlowType
      fulfilledAt
    }
  }
}
"""


def _post_gql_goals(operation: str, variables: dict[str, Any], query: str) -> dict[str, Any]:
    """GraphQL de metas: headers x-fintual-* + cookies (mismo origen que FINTUAL_GQL por defecto)."""
    headers = {
        **_gql_headers(),
        "x-fintual-session": fintual_session(),
        "x-fintual-uid": fintual_uid(),
    }
    with httpx.Client(headers=headers, cookies=_cookie_dict(), timeout=120.0) as client:
        r = client.post(
            FINTUAL_GQL_GOALS,
            json={"operationName": operation, "variables": variables, "query": query},
        )
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(f"[fintual/gql-goals] {operation}: {body['errors']}")
    return body.get("data") or {}


def _goals_rest_headers() -> dict[str, str]:
    """
    Headers mínimos para goals (sin Referer/Origin de stocks).
    """
    return {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
    }


FINTUAL_SITE_ORIGIN = "https://fintual.cl"


def get_goals_rest() -> list[dict[str, Any]]:
    """
    Todas las goals del usuario desde GET /api/goals/, siguiendo `links.next` si la API pagina.
    """
    out: list[dict[str, Any]] = []
    url: str | None = urljoin(FINTUAL_SITE_ORIGIN + "/", "api/goals/")
    max_pages = 40
    page = 0
    with httpx.Client(headers=_goals_rest_headers(), cookies=_cookie_dict(), timeout=90.0) as client:
        while url and page < max_pages:
            page += 1
            r = client.get(url)
            r.raise_for_status()
            body = r.json()
            chunk = body.get("data")
            if chunk is None:
                chunk = []
            if isinstance(chunk, list):
                out.extend(chunk)
            elif isinstance(chunk, dict):
                out.append(chunk)
            links = body.get("links") if isinstance(body.get("links"), dict) else {}
            next_url = links.get("next")
            if not next_url:
                break
            nu = str(next_url).strip()
            url = nu if nu.startswith("http") else urljoin(FINTUAL_SITE_ORIGIN, nu)
    return out


QUERY_GOAL_BALANCE_GRAPH = """
query GoalInvestedBalanceGraphDataPoints($goalId: ID!, $timeIntervalCode: String!) {
    balanceGraphDataPoints: clGoalBalanceGraphDataPoints(
        goalId: $goalId
        timeIntervalCode: $timeIntervalCode
    ) {
        date
        sharesCostBasisAmount
        sharesValuationAmount
    }
}
"""


def fetch_goal_balance_graph_points(goal_id: str, time_interval_code: str = "all_time") -> list[dict[str, Any]]:
    """
    Serie del gráfico de balance de la meta (mismo origen que la ficha en fintual.cl).
    `time_interval_code`: all_time | 1m | 3m | 6m | 1y | ytd
    """
    gid = str(goal_id).strip()
    if not gid:
        return []
    data = _post_gql(
        "GoalInvestedBalanceGraphDataPoints",
        {"goalId": gid, "timeIntervalCode": time_interval_code},
        QUERY_GOAL_BALANCE_GRAPH,
    )
    raw = data.get("balanceGraphDataPoints")
    return raw if isinstance(raw, list) else []


def portal_balance_snapshot_from_graph(
    points: list[dict[str, Any]],
) -> tuple[float, float, float, float] | None:
    """
    Último punto del gráfico de balance de la meta (misma fuente que fintual.cl).

    Tras retiros, Fintual ajusta costo de cuotas y valor; conviene usar **este** par NAV / “invertido”
    y no mezclar `nav_clp` / `deposited_clp` del REST con la ganancia del gráfico.

    Returns:
        (valuation_clp, cost_basis_clp, profit_clp, profit_pct) o None.
    """
    if not points:
        return None

    def sort_key(p: dict[str, Any]) -> str:
        return str(p.get("date") or "")

    sorted_pts = sorted(points, key=sort_key)
    last = sorted_pts[-1]
    try:
        cost = float(last.get("sharesCostBasisAmount") or 0.0)
        value = float(last.get("sharesValuationAmount") or 0.0)
    except (TypeError, ValueError):
        return None
    profit = value - cost
    if cost > 1e-9:
        pct = profit / cost * 100.0
    else:
        pct = 0.0
    return value, cost, profit, pct


def portal_profit_from_balance_graph(points: list[dict[str, Any]]) -> tuple[float, float] | None:
    """
    Rentabilidad como en el portal: último punto = valor de cuotas − costo de cuotas (no el `profit` REST,
    que suele ser ganancia monetaria histórica distinta).
    Devuelve (ganancia_clp, rentabilidad_pct) o None si no hay datos.
    """
    snap = portal_balance_snapshot_from_graph(points)
    if snap is None:
        return None
    _, _, profit, pct = snap
    return profit, pct


_GOAL_MV_TYPES = (
    "Walle::UserDeposit",
    "Walle::UnrestrictedWithdrawal",
)


def fetch_goal_movements_all_pages(goal_id: str, page_size: int = 200) -> list[dict[str, Any]]:
    """Páginas de `clGoalMovementsActivity` hasta cubrir `totalRecords`."""
    gid = str(goal_id).strip()
    all_m: list[dict[str, Any]] = []
    page = 1
    while True:
        data = _post_gql_goals(
            "GoalMovementsActivity",
            {"goalId": gid, "page": page, "pageSize": page_size},
            QUERY_GOAL_MOVEMENTS,
        )
        act = data.get("goalMovementsActivity") or {}
        movements = act.get("standardizedPortfolioMovements") or []
        total = int((act.get("pagination") or {}).get("totalRecords") or 0)
        all_m.extend(movements)
        if not movements or len(all_m) >= total:
            break
        page += 1
    return all_m


def get_stock_positions_raw() -> list[dict[str, Any]]:
    data = _post_gql("StocksPositions", {}, QUERY_POSITIONS)
    return data.get("stocksPositions") or []


def get_asset_details(symbol: str) -> dict[str, Any]:
    data = _post_gql("StocksAssetDetails", {"assetSymbol": symbol}, QUERY_ASSET_DETAILS)
    asset = data.get("stocksAsset") or {}
    return {
        "id": str(asset.get("id", "")),
        "symbol": asset.get("symbol", symbol),
        "name": (asset.get("name") or symbol or "").strip(),
        "overview": asset.get("overview"),
    }


def fetch_wallet_graphql(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    with httpx.Client(headers=_gql_headers(), cookies=_cookie_dict(), timeout=120.0) as client:
        r = client.post(
            FINTUAL_GQL,
            json={
                "operationName": "WalletMovements",
                "variables": {"limit": limit, "offset": offset},
                "query": WALLET_QUERY,
            },
        )
    r.raise_for_status()
    return r.json()


def _wallet_page_has_more(page: dict[str, Any], limit: int) -> bool:
    """True si alguna colección en esta página llegó al `limit` (puede haber más páginas)."""
    for v in page.values():
        if isinstance(v, list) and len(v) >= limit:
            return True
        if isinstance(v, dict):
            for sv in v.values():
                if isinstance(sv, list) and len(sv) >= limit:
                    return True
    return False


def _merge_wallet_data_chunk(acc: dict[str, Any], chunk: dict[str, Any]) -> dict[str, Any]:
    """Concatena listas de un chunk de `data` al acumulador (incl. anidadas tipo ACAT)."""
    out = {k: v for k, v in acc.items()}
    for k, v in chunk.items():
        if isinstance(v, list):
            out[k] = list(out.get(k, [])) + v
        elif isinstance(v, dict):
            merged_sub = dict(out.get(k, {}))
            for sk, sv in v.items():
                if isinstance(sv, list):
                    merged_sub[sk] = list(merged_sub.get(sk, [])) + sv
                else:
                    merged_sub[sk] = sv
            out[k] = merged_sub
        else:
            out[k] = v
    return out


def fetch_wallet_graphql_all_pages(limit: int = 100) -> dict[str, Any]:
    """
    Descarga todos los bloques de WalletMovements paginando `offset` hasta que ninguna
    lista devuelva una página llena.
    """
    merged: dict[str, Any] = {}
    offset = 0
    while True:
        body = fetch_wallet_graphql(limit=limit, offset=offset)
        if body.get("errors"):
            raise RuntimeError(f"[fintual/gql] WalletMovements: {body['errors']}")
        d = body.get("data") or {}
        merged = _merge_wallet_data_chunk(merged, d)
        if not _wallet_page_has_more(d, limit):
            break
        offset += limit
    return {"data": merged}


def _parse_iso_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _sort_datetime_for_buy(buy: dict[str, Any]) -> datetime:
    ao = buy.get("assetOrder") or {}
    ft = _parse_iso_dt(ao.get("fulfilledAt")) or _parse_iso_dt(buy.get("declaredAt"))
    return ft or datetime(1970, 1, 1)


def _sort_datetime_for_sell(sell: dict[str, Any]) -> datetime:
    ao = sell.get("assetOrder") or {}
    ft = _parse_iso_dt(ao.get("fulfilledAt")) or _parse_iso_dt(sell.get("declaredAt"))
    return ft or datetime(1970, 1, 1)


def _parse_iso_to_date(s: str | None) -> date | None:
    dt = _parse_iso_dt(s)
    return dt.date() if dt else None


def _is_dividend_reinvestment(buy: dict[str, Any], dividends: list[dict[str, Any]]) -> tuple[bool, dict[str, Any] | None]:
    ao = buy.get("assetOrder") or {}
    cap = ao.get("capital") or {}
    try:
        buy_capital = float(cap["amount"])
    except (KeyError, TypeError, ValueError):
        return False, None
    buy_dt = _parse_iso_dt(buy.get("declaredAt"))
    if not buy_dt:
        return False, None
    buy_day = buy_dt.date() if hasattr(buy_dt, "date") else buy_dt

    for div in dividends:
        try:
            div_amount = float((div.get("netCapital") or {})["amount"])
        except (KeyError, TypeError, ValueError):
            continue
        if abs(buy_capital - div_amount) > DIVIDEND_MATCH_TOLERANCE:
            continue
        div_dt = _parse_iso_dt(div.get("date"))
        if not div_dt:
            continue
        div_day = div_dt.date() if hasattr(div_dt, "date") else div_dt
        delta = buy_day - div_day
        if isinstance(delta, timedelta) and 0 <= delta.days <= DIVIDEND_MATCH_DAYS:
            return True, div
    return False, None


def get_buys_and_dividends(symbol: str, limit: int = 500) -> dict[str, Any]:
    sym = symbol.upper().strip()
    data = _post_gql(
        "StocksAssetMovements",
        {"assetSymbol": sym, "limit": limit, "offset": 0},
        QUERY_BUYS_AND_DIVIDENDS,
    )
    raw_buys = data.get("stocksAssetMarketBuys") or []
    movements = data.get("stocksAssetMovements") or {}
    dividends = movements.get("receivedDividends") or []
    splits = movements.get("splits") or []

    manual_buys: list[dict[str, Any]] = []
    reinvested: list[dict[str, Any]] = []
    reinvested_div_ids: set[str] = set()

    for buy in raw_buys:
        ao = buy.get("assetOrder") or {}
        if (ao.get("state") or "") != "fulfilled":
            continue
        is_reinv, matched = _is_dividend_reinvestment(buy, dividends)
        if is_reinv and matched:
            reinvested_div_ids.add(str(matched["id"]))
            reinvested.append(buy)
        else:
            manual_buys.append(buy)

    return {
        "symbol": sym,
        "manual_buys": manual_buys,
        "reinvested_dividends": reinvested,
        "reinvested_dividend_ids": reinvested_div_ids,
        "received_dividends": dividends,
        "splits": splits,
    }


def _enrich_sell(client: httpx.Client, sell: dict[str, Any]) -> dict[str, Any]:
    try:
        r = client.post(
            FINTUAL_GQL,
            json={
                "operationName": "StocksAssetMarketSell",
                "variables": {"id": sell["id"]},
                "query": QUERY_SELL_DETAIL,
            },
        )
        r.raise_for_status()
        body = r.json()
        if body.get("errors"):
            sell["_enriched"] = False
            return sell
        detail = (body.get("data") or {}).get("stocksAssetMarketSell") or {}
        if detail.get("assetOrder"):
            sell.setdefault("assetOrder", {}).update(
                {
                    "averagePrice": detail["assetOrder"].get("averagePrice"),
                    "capital": detail["assetOrder"].get("capital"),
                    "fulfilledAt": detail["assetOrder"].get("fulfilledAt"),
                    "shares": detail["assetOrder"].get("shares"),
                    "state": detail["assetOrder"].get("state"),
                }
            )
        sell["_enriched"] = True
    except Exception as exc:
        logger.debug("enrich sell %s: %s", sell.get("id"), exc)
        sell["_enriched"] = False
    return sell


def get_sells(symbol: str, limit: int = 500, enrich: bool = True) -> list[dict[str, Any]]:
    sym = symbol.upper().strip()
    data = _post_gql(
        "StocksAssetMovements",
        {"assetSymbol": sym, "limit": limit, "offset": 0},
        QUERY_SELLS_LIST,
    )
    sells = data.get("stocksAssetMarketSells") or []
    if not enrich:
        return sells
    with httpx.Client(headers=_gql_headers(), cookies=_cookie_dict(), timeout=60.0) as client:
        out = []
        for s in sells:
            ao = s.get("assetOrder") or {}
            if ao.get("state") == "fulfilled":
                out.append(_enrich_sell(client, s))
            else:
                out.append({**s, "_enriched": False})
        return out


def _jwt_from_auth_response(resp: httpx.Response) -> str:
    jwt = resp.cookies.get("stocks-pricing_service_jwt")
    if jwt:
        return jwt
    get_list = getattr(resp.headers, "get_list", None)
    if callable(get_list):
        for header_val in get_list("set-cookie"):
            if "stocks-pricing_service_jwt=" in header_val:
                for part in header_val.split(";"):
                    part = part.strip()
                    if part.startswith("stocks-pricing_service_jwt="):
                        return part.split("=", 1)[1]
    for key, val in resp.headers.multi_items():
        if key.lower() == "set-cookie" and "stocks-pricing_service_jwt=" in val:
            chunk = val.split("stocks-pricing_service_jwt=", 1)[1].split(";", 1)[0].strip()
            if chunk:
                return chunk
    raise RuntimeError("[fintual/jwt] No se pudo obtener stocks-pricing_service_jwt")


def refresh_pricing_jwt() -> str:
    with httpx.Client(
        headers={
            "User-Agent": "Mozilla/5.0",
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Referer": "https://fintual.cl/",
        },
        cookies=_cookie_dict(),
        timeout=30.0,
    ) as client:
        resp = client.post(FINTUAL_JWT_URL, json={"aud": "stocks-pricing"})
    resp.raise_for_status()
    return _jwt_from_auth_response(resp)


def get_historical_prices_raw(
    symbol: str,
    *,
    start: str = DEFAULT_HIST_START,
    timeframe: str = DEFAULT_TIMEFRAME,
    limit: int = DEFAULT_LIMIT,
    jwt: str | None = None,
) -> list[dict[str, Any]]:
    if jwt is None:
        jwt = refresh_pricing_jwt()
    params = {
        "symbol": symbol.upper().strip(),
        "timeframe": timeframe,
        "limit": limit,
        "start": start,
    }
    cookies = {**_cookie_dict(), "stocks-pricing_service_jwt": jwt}
    with httpx.Client(
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
            "Referer": "https://fintual.cl/",
        },
        cookies=cookies,
        timeout=60.0,
    ) as client:
        resp = client.get(FINTUAL_PRICING_HISTORICAL, params=params)
    resp.raise_for_status()
    body = resp.json()
    return body.get("prices") or []


def get_current_prices_raw(symbols: list[str]) -> list[dict[str, Any]]:
    if not symbols:
        return []
    jwt = refresh_pricing_jwt()
    cookies = {**_cookie_dict(), "stocks-pricing_service_jwt": jwt}
    with httpx.Client(
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "*/*",
            "Referer": "https://fintual.cl/",
        },
        cookies=cookies,
        timeout=30.0,
    ) as client:
        resp = client.get(
            FINTUAL_PRICING_CURRENT,
            params={"symbols": ",".join(s.upper().strip() for s in symbols if s.strip())},
        )
    resp.raise_for_status()
    body = resp.json()
    return body.get("prices") or []
