"""Caché persistente de nombres de activos (Fintual) por ticker — evita llamadas repetidas a la API."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import StockAsset


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def upsert_stock_asset(
    db: Session,
    symbol: str,
    name: str | None,
    *,
    fintual_asset_id: str | None = None,
) -> None:
    """Guarda o actualiza el nombre legible de un ticker (si es distinto del propio símbolo)."""
    sym = symbol.upper().strip()
    if not sym:
        return
    n = (name or "").strip()
    if not n or n.upper() == sym:
        return
    now = _utc_now()
    row = db.query(StockAsset).filter(StockAsset.symbol == sym).first()
    if row:
        row.name = n
        row.updated_at = now
        if fintual_asset_id:
            row.fintual_asset_id = fintual_asset_id
    else:
        db.add(
            StockAsset(
                symbol=sym,
                name=n,
                fintual_asset_id=fintual_asset_id,
                updated_at=now,
            )
        )


def get_stock_display_from_db(db: Session, symbol: str) -> dict[str, str] | None:
    """Si hay fila en caché con nombre útil, devuelve `{symbol, name}`; si no hay datos útiles, `None` (se puede refrescar vía API)."""
    sym = symbol.strip().upper()
    if not sym:
        return None
    row = db.query(StockAsset).filter(StockAsset.symbol == sym).first()
    if not row:
        return None
    n = (row.name or "").strip()
    if not n or n.upper() == sym:
        return None
    return {"symbol": sym, "name": n}
