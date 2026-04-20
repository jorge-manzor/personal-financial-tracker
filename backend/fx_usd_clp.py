"""
USD/CLP — DolarAPI (spot) + CMF Chile (histórico).

CMF requiere CMF_API_KEY en el entorno (registro gratuito en https://api.cmfchile.cl/registro).
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DOLARAPI_URL = "https://cl.dolarapi.com/v1/cotizaciones/usd"
CMF_BASE_URL = "https://api.cmfchile.cl/api-sbifv3/recursos_api/dolar"

# Evita 403 en algunos proxys/CDN que bloquean clientes sin User-Agent.
_HTTP_HEADERS = {
    "User-Agent": "personal-financial-tracker/1.0",
    "Accept": "application/json",
}


def cmf_api_key() -> str:
    return (os.environ.get("CMF_API_KEY") or "").strip()


def cmf_configured() -> bool:
    return bool(cmf_api_key())


def _check_api_key() -> None:
    if not cmf_api_key():
        raise RuntimeError(
            "CMF_API_KEY no está configurada. Registro: https://api.cmfchile.cl/registro"
        )


def _cmf_params() -> dict:
    return {"apikey": cmf_api_key(), "formato": "json"}


def _parse_cmf_valor(valor_str: str) -> float:
    return float(valor_str.replace(".", "").replace(",", "."))


def _parse_cmf_records(data: dict) -> list:
    dolares = data.get("Dolares") or []
    result: list[dict] = []
    for item in dolares:
        try:
            result.append({"fecha": item["Fecha"], "valor": _parse_cmf_valor(item["Valor"])})
        except (KeyError, ValueError):
            continue
    return result


def _cmf_get(url: str) -> list:
    _check_api_key()
    with httpx.Client(timeout=10.0, headers=_HTTP_HEADERS) as client:
        resp = client.get(url, params=_cmf_params())
    resp.raise_for_status()
    return _parse_cmf_records(resp.json())


def _fetch_year(year: int) -> list:
    url = f"{CMF_BASE_URL}/{year:04d}"
    return _cmf_get(url)


def _fetch_from_date(from_date: date) -> list:
    url = (
        f"{CMF_BASE_URL}/posteriores"
        f"/{from_date.year:04d}/{from_date.month:02d}/dias/{from_date.day:02d}"
    )
    return _cmf_get(url)


def get_current_rate(timeout: float = 5.0) -> dict:
    """
    USD/CLP actual: DolarAPI; si falla, última observación CMF del mes en curso.
    """
    try:
        with httpx.Client(timeout=timeout, headers=_HTTP_HEADERS) as client:
            resp = client.get(DOLARAPI_URL)
        resp.raise_for_status()
        data = resp.json()
        item = data[0] if isinstance(data, list) else data
        return {
            "compra": float(item["compra"]),
            "venta": float(item["venta"]),
            "ultimo_cierre": float(item.get("ultimoCierre", item["venta"])),
            "fecha_actualizacion": item.get("fechaActualizacion", ""),
            "fuente": "dolarapi",
        }
    except Exception as exc:
        logger.warning("DolarAPI falló (%s), usando CMF…", exc)
        return _get_current_rate_cmf_fallback()


def _get_current_rate_cmf_fallback() -> dict:
    records = _cmf_get(CMF_BASE_URL)
    if not records:
        raise RuntimeError("No se pudo obtener USD/CLP desde ninguna fuente.")
    last = sorted(records, key=lambda x: x["fecha"])[-1]
    return {
        "compra": last["valor"],
        "venta": last["valor"],
        "ultimo_cierre": last["valor"],
        "fecha_actualizacion": last["fecha"],
        "fuente": "cmf_fallback",
    }


def get_historical_rates(fecha_inicio: date, fecha_fin: date) -> list:
    """Histórico CMF entre fechas (solo días hábiles publicados)."""
    today = date.today()
    seen: dict[str, float] = {}
    years_needed = list(range(fecha_inicio.year, fecha_fin.year + 1))

    for year in years_needed:
        if year < today.year:
            records = _fetch_year(year)
        else:
            start = fecha_inicio if fecha_inicio.year == year else date(year, 1, 1)
            records = _fetch_from_date(start)
        for r in records:
            seen[r["fecha"]] = r["valor"]

    inicio_str = fecha_inicio.strftime("%Y-%m-%d")
    fin_str = fecha_fin.strftime("%Y-%m-%d")
    filtered = [{"fecha": f, "valor": v} for f, v in seen.items() if inicio_str <= f <= fin_str]
    return sorted(filtered, key=lambda x: x["fecha"])


def get_rate_for_date_cmf(target: date, max_lookback: int = 5) -> Optional[float]:
    start = target - timedelta(days=max_lookback)
    history = get_historical_rates(start, target)
    if not history:
        return None
    return history[-1]["valor"]
