from __future__ import annotations

from datetime import datetime, time

from fastapi import HTTPException
from sqlalchemy.orm import Session

from history import transaction_occurred_at
from models import Transaction


def replay_validate_rows(rows: list[Transaction]) -> None:
    rows = sorted(rows, key=lambda t: (transaction_occurred_at(t), t.id))
    sh = 0.0
    for tx in rows:
        if tx.tipo == "dividendo":
            continue
        if (tx.tipo or "").lower() == "division_accion":
            continue
        if tx.tipo in ("compra", "reinversion"):
            sh += float(tx.acciones)
        elif tx.tipo == "venta":
            if sh + 1e-9 < float(tx.acciones):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No hay suficientes acciones de {tx.activo} para la venta del {tx.fecha} "
                        f"(disponibles: {sh:.6f})"
                    ),
                )
            sh -= float(tx.acciones)


def all_tx_for_ticker(db: Session, sym: str) -> list[Transaction]:
    rows = db.query(Transaction).filter(Transaction.activo == sym.upper()).all()
    rows.sort(key=lambda t: (transaction_occurred_at(t), t.id))
    return rows


def validate_state_after_update(db: Session, tx_id: int, body) -> None:
    old = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not old:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")

    new_sym = body.activo.upper().strip()
    old_sym = old.activo.upper()
    syms = {old_sym, new_sym}

    for sym in syms:
        base = [t for t in all_tx_for_ticker(db, sym) if t.id != tx_id]
        if sym == new_sym:
            oa = datetime.combine(body.fecha, time(12, 0, 0))
            base.append(
                Transaction(
                    id=tx_id,
                    fecha=body.fecha,
                    tipo=body.tipo,
                    activo=sym,
                    acciones=body.acciones,
                    precio_unitario=body.precio_unitario,
                    monto_total=body.monto_total,
                    categoria=body.categoria,
                    currency=body.currency,
                    nombre_activo=body.nombre_activo,
                    occurred_at=oa,
                )
            )
        replay_validate_rows(base)


def validate_state_after_delete(db: Session, tx_id: int) -> None:
    old = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not old:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")

    sym = old.activo.upper()
    base = [t for t in all_tx_for_ticker(db, sym) if t.id != tx_id]
    replay_validate_rows(base)
