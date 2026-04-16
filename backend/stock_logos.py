"""
Logos de tickers US: Fintual GCS → FMP → Clearbit; PNG en `backend/data/logos/`.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

LOGOS_DIR = Path(__file__).resolve().parent / "data" / "logos"

FINTUAL_LOGO_URL = "https://storage.googleapis.com/fintual-public/asset-logo-icons/{symbol}.png"
FMP_URL = "https://financialmodelingprep.com/image-stock/{symbol}.png"
CLEARBIT_URL = "https://logo.clearbit.com/{domain}"

SYMBOL_DOMAIN_MAP = {
    "NVDA": "nvidia.com",
    "MSFT": "microsoft.com",
    "AMZN": "amazon.com",
    "ALAB": "asteralabs.com",
    "FCX": "fcx.com",
    "MA": "mastercard.com",
    "V": "visa.com",
    "GS": "goldmansachs.com",
    "BABA": "alibaba.com",
    "SPG": "simon.com",
    "SPY": "ssga.com",
    "GLD": "ssga.com",
    "XLV": "ssga.com",
    "XLU": "ssga.com",
    "XBI": "ssga.com",
    "VOO": "vanguard.com",
    "VGK": "vanguard.com",
    "VWO": "vanguard.com",
    "QQQ": "invesco.com",
    "SMH": "vaneck.com",
}

SYMBOL_ISSUER_MAP = {
    "SPY": "SPDR",
    "GLD": "SPDR",
    "XLV": "SPDR",
    "XLU": "SPDR",
    "XBI": "SPDR",
    "VOO": "Vanguard",
    "VGK": "Vanguard",
    "VWO": "Vanguard",
    "QQQ": "Invesco",
    "SMH": "VanEck",
}

_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,15}$")


def is_valid_ticker_for_logo(symbol: str) -> bool:
    s = symbol.upper().strip()
    return bool(_TICKER_RE.fullmatch(s))


def _is_image(response: httpx.Response) -> bool:
    return response.status_code == 200 and "image" in response.headers.get("content-type", "")


def _try_fetch(url: str) -> httpx.Response | None:
    try:
        r = httpx.get(url, timeout=10, follow_redirects=True)
        if _is_image(r):
            return r
    except Exception as exc:
        logger.debug("logo fetch failed %s: %s", url, exc)
    return None


def download_logo(symbol: str, force: bool = False) -> Path | None:
    """
    Descarga el logo con prioridad: Fintual GCS → FMP → Clearbit.
    Guarda en LOGOS_DIR/{SYMBOL}.png
    """
    sym = symbol.upper().strip()
    LOGOS_DIR.mkdir(parents=True, exist_ok=True)
    dest = LOGOS_DIR / f"{sym}.png"

    if dest.exists() and not force:
        return dest

    url = FINTUAL_LOGO_URL.format(symbol=sym)
    r = _try_fetch(url)
    if r:
        dest.write_bytes(r.content)
        logger.info("logo %s: Fintual GCS (%s KB)", sym, round(len(r.content) / 1024, 1))
        return dest

    r = _try_fetch(FMP_URL.format(symbol=sym))
    if r:
        dest.write_bytes(r.content)
        logger.info("logo %s: FMP", sym)
        return dest

    domain = SYMBOL_DOMAIN_MAP.get(sym)
    if domain:
        r = _try_fetch(CLEARBIT_URL.format(domain=domain))
        if r:
            dest.write_bytes(r.content)
            logger.info("logo %s: Clearbit (%s)", sym, domain)
            return dest

    logger.warning("logo %s: no disponible en ninguna fuente", sym)
    return None


def ensure_logo(symbol: str) -> Path | None:
    """Path al PNG local; descarga si no existe."""
    return download_logo(symbol, force=False)


def get_logo_url(symbol: str) -> str:
    return FINTUAL_LOGO_URL.format(symbol=symbol.upper().strip())


def download_all_logos(symbols: list[str], force: bool = False) -> dict[str, Path | None]:
    return {sym: download_logo(sym, force=force) for sym in symbols}
