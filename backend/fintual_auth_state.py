"""
Marca en DB cuando la sesión Fintual deja de ser válida (cookie expirada ~30 días, etc.).
"""

from __future__ import annotations

import logging

import httpx
from sqlalchemy.orm import Session

from database import SessionLocal

logger = logging.getLogger(__name__)


def is_likely_fintual_auth_error(exc: BaseException) -> bool:
    """401/403 HTTP o mensajes típicos de sesión inválida en Fintual."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (401, 403)
    s = str(exc).lower()
    if " 401" in s or " 403" in s or "status code 401" in s or "status code 403" in s:
        return True
    if "unauthorized" in s or "unauthenticated" in s or "forbidden" in s:
        return True
    return False


def mark_fintual_reconnect_required(user_id: int) -> None:
    """Persistido para que GET /auth/me active el modal de reconexión."""
    db = SessionLocal()
    try:
        from models import User

        u = db.query(User).filter(User.id == user_id).first()
        if u is None:
            return
        if not getattr(u, "fintual_reconnect_required", False):
            u.fintual_reconnect_required = True
            db.add(u)
            db.commit()
            logger.info("Usuario %s: se marcó fintual_reconnect_required (sesión Fintual inválida)", user_id)
    except Exception:
        logger.exception("mark_fintual_reconnect_required failed for user %s", user_id)
    finally:
        db.close()


def clear_fintual_reconnect_required(db: Session, user_id: int) -> None:
    """Tras un sync exitoso o al guardar credenciales nuevas."""
    from models import User

    u = db.query(User).filter(User.id == user_id).first()
    if u is None:
        return
    if getattr(u, "fintual_reconnect_required", False):
        u.fintual_reconnect_required = False
        db.add(u)
        db.commit()
