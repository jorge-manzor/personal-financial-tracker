"""Rutas de autenticación y perfil (/auth/*)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    SERVICE_BANKING,
    SERVICE_INVESTMENTS,
    SERVICE_PROYECTOS,
    CurrentUser,
    create_access_token,
    default_services,
    get_user_by_email,
    has_password,
    hash_password,
    user_services,
    verify_google_id_token,
    verify_password,
)
from database import get_db
from models import User
from schemas import (
    FintualCredentialsIn,
    GoogleAuthIn,
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
        google_linked=bool((user.google_id or "").strip()),
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


@router.post("/google", response_model=TokenOut)
def auth_google(body: GoogleAuthIn, db: Session = Depends(get_db)) -> TokenOut:
    """
    Login/registro con Google. Vinculación automática (US-01): si el email del token
    (verificado por Google) coincide con una cuenta existente, se vincula ese `google_id`
    a la cuenta EXISTENTE (mismo user_id, mismo historial) — nunca se crea una cuenta nueva
    en ese caso. Nunca loguear `body.credential` ni el payload de Google.
    """
    claims = verify_google_id_token(body.credential)
    google_sub = str(claims["sub"])
    email = str(claims["email"]).strip().lower()

    user = db.query(User).filter(User.google_id == google_sub).first()
    if user is not None:
        return TokenOut(access_token=create_access_token(user_id=user.id, email=user.email))

    existing = get_user_by_email(db, email)
    if existing is not None:
        if existing.google_id and existing.google_id != google_sub:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esta cuenta ya tiene otra cuenta de Google vinculada.",
            )
        existing.google_id = google_sub
        db.add(existing)
        try:
            db.commit()
        except IntegrityError:
            # Doble clic / dos pestañas: otra request ya vinculó este google_id primero.
            db.rollback()
            existing = db.query(User).filter(User.google_id == google_sub).first()
            if existing is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="No se pudo vincular la cuenta de Google, intenta de nuevo.",
                )
        db.refresh(existing)
        return TokenOut(access_token=create_access_token(user_id=existing.id, email=existing.email))

    new_user = User(
        email=email,
        password_hash="",
        google_id=google_sub,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        services_json=json.dumps(default_services()),
    )
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        # Carrera: otra request ya creó/vinculó esta cuenta (mismo email o mismo google_id) primero.
        db.rollback()
        winner = db.query(User).filter(User.google_id == google_sub).first() or get_user_by_email(db, email)
        if winner is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No se pudo crear la cuenta, intenta de nuevo.")
        return TokenOut(access_token=create_access_token(user_id=winner.id, email=winner.email))
    db.refresh(new_user)
    return TokenOut(access_token=create_access_token(user_id=new_user.id, email=new_user.email))


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
    if body.proyectos is not None:
        svc[SERVICE_PROYECTOS] = body.proyectos
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
    if not has_password(user):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tu cuenta no tiene contraseña (usas Google para entrar).",
        )
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña actual no es correcta")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "ok"}
