"""Rutas de autenticación y perfil (/auth/*)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import (
    SERVICE_BANKING,
    SERVICE_INVESTMENTS,
    CurrentUser,
    create_access_token,
    default_services,
    get_user_by_email,
    hash_password,
    user_services,
    verify_password,
)
from database import get_db
from models import User
from schemas import (
    FintualCredentialsIn,
    PasswordChange,
    TokenOut,
    UserLogin,
    UserOut,
    UserProfilePatch,
    UserRegister,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def fintual_needs_setup(user: User) -> bool:
    """Modal de conexión / reconexión Fintual."""
    if not user_services(user).get(SERVICE_INVESTMENTS, False):
        return False
    if getattr(user, "fintual_reconnect_required", False):
        return True
    if (user.fintual_session or "").strip():
        return False
    return True


def user_out(user: User) -> UserOut:
    recon = bool(getattr(user, "fintual_reconnect_required", False))
    fs = (user.fintual_session or "").strip()
    fu = (user.fintual_uid or "").strip()
    return UserOut(
        id=user.id,
        email=user.email,
        services=user_services(user),
        fintual_needs_setup=fintual_needs_setup(user),
        fintual_reconnect_required=recon,
        fintual_session_cookie=fs or None,
        fintual_uid=fu or None,
    )


@router.post("/register", response_model=TokenOut)
def auth_register(body: UserRegister, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.strip().lower()
    if get_user_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email ya registrado")
    u = User(
        email=email,
        password_hash=hash_password(body.password),
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        services_json=json.dumps(default_services()),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return TokenOut(access_token=create_access_token(user_id=u.id, email=u.email))


@router.post("/login", response_model=TokenOut)
def auth_login(body: UserLogin, db: Session = Depends(get_db)) -> TokenOut:
    u = get_user_by_email(db, body.email.strip().lower())
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    return TokenOut(access_token=create_access_token(user_id=u.id, email=u.email))


@router.get("/me", response_model=UserOut)
def auth_me(user: CurrentUser) -> UserOut:
    return user_out(user)


@router.patch("/me", response_model=UserOut)
def auth_patch_me(
    body: UserProfilePatch,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> UserOut:
    svc = user_services(user)
    if body.investments is not None:
        svc[SERVICE_INVESTMENTS] = body.investments
    if body.banking is not None:
        svc[SERVICE_BANKING] = body.banking
    user.services_json = json.dumps(svc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.patch("/me/fintual", response_model=UserOut)
def auth_patch_fintual(
    body: FintualCredentialsIn,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> UserOut:
    user.fintual_session = body.session_cookie.strip()
    uid = (body.uid or "").strip()
    user.fintual_uid = uid if uid else None
    user.fintual_reconnect_required = False
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_out(user)


@router.post("/change-password")
def auth_change_password(
    body: PasswordChange,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña actual no es correcta")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "ok"}
