"""
Autenticación: email + contraseña (bcrypt), JWT Bearer.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from database import get_db
from models import User

security = HTTPBearer(auto_error=False)

# Claves de `services_json` / API de perfil (extensible a futuras funcionalidades).
SERVICE_INVESTMENTS = "investments"
SERVICE_BANKING = "banking"


def default_services() -> dict[str, bool]:
    return {SERVICE_INVESTMENTS: False, SERVICE_BANKING: False}


def user_services(user: User) -> dict[str, bool]:
    out = default_services()
    raw = getattr(user, "services_json", None)
    if not raw:
        return out
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, bool):
                    out[k] = v
    except json.JSONDecodeError:
        pass
    return out


def investments_enabled(user: User) -> bool:
    return bool(user_services(user).get(SERVICE_INVESTMENTS, False))


def banking_enabled(user: User) -> bool:
    return bool(user_services(user).get(SERVICE_BANKING, False))


JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-change-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 14


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(*, user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_user_by_email(db: Session, email: str) -> User | None:
    norm = email.strip().lower()
    return db.query(User).filter(User.email == norm).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_current_user(
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(credentials.credentials)
        uid = int(payload.get("sub", 0))
    except (JWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_user_by_id(db, uid)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_user_sse(
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    access_token: str | None = Query(default=None, alias="access_token"),
) -> User:
    """Igual que get_current_user pero acepta `?access_token=` (EventSource no manda Authorization)."""
    raw = (access_token or "").strip() or (
        credentials.credentials if credentials and credentials.credentials else None
    )
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(raw)
        uid = int(payload.get("sub", 0))
    except (JWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_user_by_id(db, uid)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


CurrentUserSSE = Annotated[User, Depends(get_current_user_sse)]


def require_investments_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not investments_enabled(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Servicio de inversiones desactivado",
        )
    return user


def require_investments_user_sse(
    user: Annotated[User, Depends(get_current_user_sse)],
) -> User:
    if not investments_enabled(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Servicio de inversiones desactivado",
        )
    return user


InvestmentsUser = Annotated[User, Depends(require_investments_user)]
InvestmentsUserSSE = Annotated[User, Depends(require_investments_user_sse)]


def get_optional_user(
    db: Annotated[Session, Depends(get_db)],
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> User | None:
    """JWT presente y válido → usuario; si no hay token o es inválido → None (sin error 401)."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
        uid = int(payload.get("sub", 0))
    except (JWTError, ValueError, TypeError):
        return None
    return get_user_by_id(db, uid)


def require_banking_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if not banking_enabled(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Servicio de cuentas y movimientos desactivado",
        )
    return user


BankingUser = Annotated[User, Depends(require_banking_user)]
