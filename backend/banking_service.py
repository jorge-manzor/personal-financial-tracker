"""
Cuentas bancarias manuales, categorías (seed JSON) y movimientos con saldo por cuenta.
El monto del movimiento va con signo: positivo = ingreso, negativo = egreso.
"""

from __future__ import annotations

import json
import logging
import unicodedata
from calendar import monthrange
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import Date, cast, false as sql_false, func, literal, or_, text
from sqlalchemy.orm import Session

from models import (
    BankingAccount,
    BankingCategory,
    BankingPersonalProvisionItem,
    BankingSubcategory,
    BankingTransaction,
)


def _names_locked(cat: BankingCategory | None) -> bool:
    return bool(getattr(cat, "names_locked", True))

logger = logging.getLogger(__name__)

_DEFAULT_CATEGORIES_PATH = Path(__file__).resolve().parent / "data" / "categorias_banking_default.json"
_BANKS_CHILE_PATH = Path(__file__).resolve().parent / "data" / "bancos_chile.json"

BANKING_PRODUCT_TYPES = frozenset(
    {"cuenta_corriente", "cuenta_vista", "cuenta_prepago", "tarjeta_credito"}
)

# Categorías plantilla solo para lógica interna (p. ej. cargo/pago tarjeta). No pueden usarse en movimientos manuales.
# «Provisiones» (plantilla 21) no es interna: el usuario puede elegirla al crear o editar movimientos.
INTERNAL_BANKING_TEMPLATE_CAT_IDS = frozenset({20})

# Transferencia → Entre cuentas propias (categorias_banking_default.json).
TEMPLATE_CAT_TRANSFERENCIA = 19
TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS = 1901

# Pago Tarjeta de Credito (plantilla interna; egreso en cuenta corriente asociada).
TEMPLATE_CAT_PAGO_TARJETA_CREDITO = 20
TEMPLATE_SUB_PAGO_TARJETA_CREDITO = 2001

# Provisiones (plantilla 21): el usuario puede registrar reversas explícitas vía API dedicada.
TEMPLATE_CAT_PROVISIONES = 21


def _is_provision_reversal_movement(db: Session, user_id: int, tx: BankingTransaction) -> bool:
    """
    Reversa generada por la app (`reverse_provision_transaction_row`): categoría Provisiones (21)
    y descripción que empieza por «Reversa -».
    """
    desc = (tx.description or "").strip()
    if not desc.startswith("Reversa -"):
        return False
    cat = get_category_for_user(db, user_id, tx.category_id)
    tid = getattr(cat, "template_cat_id", None) if cat else None
    return tid is not None and int(tid) == TEMPLATE_CAT_PROVISIONES


def is_transferencia_entre_cuentas_propias(cat: BankingCategory, sub: BankingSubcategory) -> bool:
    tc = getattr(cat, "template_cat_id", None)
    ts = getattr(sub, "template_sub_id", None)
    if tc is not None and ts is not None:
        return int(tc) == TEMPLATE_CAT_TRANSFERENCIA and int(ts) == TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS
    n1 = (getattr(cat, "name", None) or "").strip()
    n2 = (getattr(sub, "name", None) or "").strip()
    return n1 == "Transferencia" and n2 == "Entre cuentas propias"


def _category_is_internal_reserved(c: BankingCategory | None) -> bool:
    tid = getattr(c, "template_cat_id", None) if c else None
    return tid is not None and int(tid) in INTERNAL_BANKING_TEMPLATE_CAT_IDS


CATEGORY_COLOR_PALETTE = (
    "#58a6ff",
    "#a371f7",
    "#f0883e",
    "#3fb950",
    "#d2a8ff",
    "#79c0ff",
    "#ff7b72",
    "#56d364",
    "#e3b341",
    "#22d3ee",
    "#8b5cf6",
    "#fb7185",
)

# Colores de UI por nombre de categoría (hex RGB pedidos por producto).
_BANK_CAT_GREEN = "#00a329"  # Remuneracion, Otros Ingresos, Ahorros, Inversiones
_BANK_CAT_GRAY = "#8f8f8f"  # Transferencia(s)
_BANK_CAT_BLUE = "#008cf0"  # Pago Tarjeta de Credito
_BANK_CAT_ROSE = "#fb7185"  # Provisiones
_BANK_CAT_DEFAULT = "#ff7b72"  # resto

_BANK_CAT_NAMES_GREEN = frozenset({"remuneracion", "otros ingresos", "ahorros", "inversiones"})


def _banking_category_name_key(name: str | None) -> str:
    """Nombre normalizado (minúsculas, sin acentos) para reglas de color."""
    if not name or not str(name).strip():
        return ""
    n = unicodedata.normalize("NFKD", str(name).strip().lower())
    return "".join(c for c in n if unicodedata.category(c) != "Mn")


def _canonical_hex_for_banking_category_name(name: str | None) -> str | None:
    """
    Devuelve hex fijo si el nombre coincide con una categoría semántica; si no, None (→ color default).
    """
    key = _banking_category_name_key(name)
    if not key:
        return None
    if key in _BANK_CAT_NAMES_GREEN:
        return _BANK_CAT_GREEN
    if key in ("transferencia", "transferencias"):
        return _BANK_CAT_GRAY
    if key == "pago tarjeta de credito":
        return _BANK_CAT_BLUE
    if key == "provisiones":
        return _BANK_CAT_ROSE
    return None


def _parse_template_id(value: object | None) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _dedupe_banking_subcategories_by_template_id(db: Session, user_id: int) -> int:
    """
    Una sola fila por (user_id, template_sub_id) cuando template_sub_id no es null.
    Evita duplicados que rompen los dicts en sync_user_categories_from_json y multiplican la UI.
    """
    rows = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.template_sub_id.isnot(None),
        )
        .order_by(BankingSubcategory.template_sub_id, BankingSubcategory.id)
        .all()
    )
    by_tid: dict[int, list[BankingSubcategory]] = {}
    for s in rows:
        tid = int(s.template_sub_id)  # type: ignore[arg-type]
        by_tid.setdefault(tid, []).append(s)
    removed = 0
    for group in by_tid.values():
        if len(group) <= 1:
            continue
        keeper = group[0]
        for dup in group[1:]:
            db.query(BankingTransaction).filter(
                BankingTransaction.user_id == user_id,
                BankingTransaction.subcategory_id == dup.id,
            ).update(
                {"subcategory_id": keeper.id, "category_id": keeper.category_id},
                synchronize_session=False,
            )
            db.delete(dup)
            removed += 1
    if removed:
        db.flush()
        logger.info(
            "Banking dedupe: %s subcategorías duplicadas eliminadas (template_sub_id, user_id=%s)",
            removed,
            user_id,
        )
    return removed


def _dedupe_banking_categories_by_template_cat_id(db: Session, user_id: int) -> int:
    """Una sola fila por (user_id, template_cat_id) cuando template_cat_id no es null."""
    rows = (
        db.query(BankingCategory)
        .filter(
            BankingCategory.user_id == user_id,
            BankingCategory.template_cat_id.isnot(None),
        )
        .order_by(BankingCategory.template_cat_id, BankingCategory.id)
        .all()
    )
    by_tid: dict[int, list[BankingCategory]] = {}
    for c in rows:
        tid = int(c.template_cat_id)  # type: ignore[arg-type]
        by_tid.setdefault(tid, []).append(c)
    removed = 0
    for group in by_tid.values():
        if len(group) <= 1:
            continue
        keeper = group[0]
        for dup in group[1:]:
            subs = (
                db.query(BankingSubcategory)
                .filter(BankingSubcategory.category_id == dup.id, BankingSubcategory.user_id == user_id)
                .all()
            )
            for s in subs:
                twin = None
                if s.template_sub_id is not None:
                    twin = (
                        db.query(BankingSubcategory)
                        .filter(
                            BankingSubcategory.category_id == keeper.id,
                            BankingSubcategory.user_id == user_id,
                            BankingSubcategory.template_sub_id == s.template_sub_id,
                        )
                        .first()
                    )
                if twin is not None and twin.id != s.id:
                    db.query(BankingTransaction).filter(
                        BankingTransaction.user_id == user_id,
                        BankingTransaction.subcategory_id == s.id,
                    ).update(
                        {"subcategory_id": twin.id, "category_id": keeper.id},
                        synchronize_session=False,
                    )
                    db.delete(s)
                else:
                    s.category_id = keeper.id
            db.query(BankingTransaction).filter(
                BankingTransaction.user_id == user_id,
                BankingTransaction.category_id == dup.id,
            ).update({"category_id": keeper.id}, synchronize_session=False)
            db.delete(dup)
            removed += 1
    if removed:
        db.flush()
        logger.info(
            "Banking dedupe: %s categorías duplicadas eliminadas (template_cat_id, user_id=%s)",
            removed,
            user_id,
        )
    return removed


def dedupe_banking_catalog_for_user(db: Session, user_id: int) -> None:
    """Ordene: primero subs por template_sub_id, luego categorías por template_cat_id."""
    _dedupe_banking_subcategories_by_template_id(db, user_id)
    _dedupe_banking_categories_by_template_cat_id(db, user_id)


def _load_default_categories_json() -> list | None:
    if not _DEFAULT_CATEGORIES_PATH.is_file():
        return None
    raw = json.loads(_DEFAULT_CATEGORIES_PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else None


def _subcategory_matches_default_for_category(
    s: BankingSubcategory,
    expected_tpl_ids: set[int],
    expected_names_lower: set[str],
) -> bool:
    """True si la subcategoría corresponde a una fila del JSON en esta categoría."""
    tid = getattr(s, "template_sub_id", None)
    if tid is not None:
        return int(tid) in expected_tpl_ids
    return s.name.strip().lower() in expected_names_lower


def _subcategory_is_user_custom_name(
    s: BankingSubcategory,
    expected_names_lower: set[str],
) -> bool:
    """Usuario añadió esta sub (`template_sub_id` nulo y nombre no coincide con la plantilla por nombre solo)."""
    if getattr(s, "template_sub_id", None) is not None:
        return False
    return s.name.strip().lower() not in expected_names_lower


def _realign_bank_subcategories_by_template(db: Session, user_id: int, raw: list) -> None:
    """
    Mueve subcategorías a la categoría plantilla que indica el JSON (p. ej. filas heredadas
    con el `template_sub_id` colgando de otra categoría).
    """
    sub_to_cat: dict[int, int] = {}
    for cat in raw:
        if not isinstance(cat, dict):
            continue
        ctid = _parse_template_id(cat.get("id"))
        if ctid is None:
            continue
        for sraw in cat.get("subcategories") or []:
            if not isinstance(sraw, dict):
                continue
            stid = _parse_template_id(sraw.get("id"))
            if stid is not None:
                sub_to_cat[int(stid)] = int(ctid)

    if not sub_to_cat:
        return

    user_cats_by_tpl: dict[int, BankingCategory] = {
        int(c.template_cat_id): c
        for c in db.query(BankingCategory).filter(BankingCategory.user_id == user_id).all()
        if c.template_cat_id is not None
    }

    subs = (
        db.query(BankingSubcategory)
        .filter(BankingSubcategory.user_id == user_id)
        .filter(BankingSubcategory.template_sub_id.isnot(None))
        .all()
    )
    for s in subs:
        stid = int(s.template_sub_id)  # type: ignore[arg-type]
        ctid = sub_to_cat.get(stid)
        if ctid is None:
            continue
        target = user_cats_by_tpl.get(ctid)
        if target is None or s.category_id == target.id:
            continue
        twin = (
            db.query(BankingSubcategory)
            .filter(
                BankingSubcategory.category_id == target.id,
                BankingSubcategory.template_sub_id == stid,
            )
            .first()
        )
        if twin is not None and twin.id != s.id:
            db.query(BankingTransaction).filter(
                BankingTransaction.user_id == user_id,
                BankingTransaction.subcategory_id == s.id,
            ).update(
                {"subcategory_id": twin.id, "category_id": target.id},
                synchronize_session=False,
            )
            db.delete(s)
        else:
            db.query(BankingTransaction).filter(
                BankingTransaction.user_id == user_id,
                BankingTransaction.subcategory_id == s.id,
            ).update(
                {"category_id": target.id},
                synchronize_session=False,
            )
            s.category_id = target.id
    db.flush()


def _prune_bank_subcategories_not_in_default_json(db: Session, user_id: int) -> None:
    """
    En categorías con plantilla fijada, elimina subcategorías que no existen en
    `categorias_banking_default.json`. Reasigna movimientos a la primera sub válida de la misma categoría.
    """
    raw = _load_default_categories_json()
    if not raw:
        return

    all_user_cats = db.query(BankingCategory).filter(BankingCategory.user_id == user_id).all()
    by_tpl_cat: dict[int, BankingCategory] = {}
    by_name_lower: dict[str, BankingCategory] = {}
    for c in sorted(all_user_cats, key=lambda x: x.id):
        tc = getattr(c, "template_cat_id", None)
        if tc is not None:
            ik = int(tc)
            if ik not in by_tpl_cat:
                by_tpl_cat[ik] = c
        nl = c.name.strip().lower()
        if nl not in by_name_lower:
            by_name_lower[nl] = c

    pruned = 0
    for cat in raw:
        if not isinstance(cat, dict):
            continue
        name = (cat.get("name") or "").strip()
        if not name:
            continue
        tpl_id = _parse_template_id(cat.get("id"))
        bc: BankingCategory | None = by_tpl_cat.get(tpl_id) if tpl_id is not None else None
        if bc is None:
            bc = by_name_lower.get(name.lower())
        if bc is None or not _names_locked(bc):
            continue

        subs_raw = cat.get("subcategories") if isinstance(cat.get("subcategories"), list) else []
        expected_tpl_ids: set[int] = set()
        expected_names_lower: set[str] = set()
        for sraw in subs_raw:
            if not isinstance(sraw, dict):
                continue
            sn = (sraw.get("name") or "").strip()
            if not sn:
                continue
            st = _parse_template_id(sraw.get("id"))
            if st is not None:
                expected_tpl_ids.add(int(st))
            expected_names_lower.add(sn.lower())

        if not expected_tpl_ids and not expected_names_lower:
            continue

        subs = (
            db.query(BankingSubcategory)
            .filter(BankingSubcategory.category_id == bc.id, BankingSubcategory.user_id == user_id)
            .order_by(BankingSubcategory.sort_order, BankingSubcategory.id)
            .all()
        )
        valid = [s for s in subs if _subcategory_matches_default_for_category(s, expected_tpl_ids, expected_names_lower)]
        if not valid:
            continue
        fallback = valid[0]

        for s in list(subs):
            if _subcategory_matches_default_for_category(s, expected_tpl_ids, expected_names_lower):
                continue
            if _subcategory_is_user_custom_name(s, expected_names_lower):
                continue
            n_tx = (
                db.query(func.count(BankingTransaction.id))
                .filter(
                    BankingTransaction.user_id == user_id,
                    BankingTransaction.subcategory_id == s.id,
                )
                .scalar()
                or 0
            )
            if int(n_tx) > 0:
                db.query(BankingTransaction).filter(
                    BankingTransaction.user_id == user_id,
                    BankingTransaction.subcategory_id == s.id,
                ).update(
                    {
                        "subcategory_id": fallback.id,
                        "category_id": bc.id,
                    },
                    synchronize_session=False,
                )
            db.delete(s)
            pruned += 1
    if pruned:
        db.commit()
        logger.info(
            "Limpieza subcategorías: eliminadas %s fila(s) no presentes en la plantilla (user_id=%s)",
            pruned,
            user_id,
        )


def _normalize_hex_color(value: object | None) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if len(s) == 4 and s.startswith("#"):
        r, g, b = s[1], s[2], s[3]
        s = f"#{r}{r}{g}{g}{b}{b}"
    if len(s) == 7 and s.startswith("#"):
        tail = s[1:]
        if len(tail) == 6 and all(c in "0123456789abcdefABCDEF" for c in tail):
            return f"#{tail.lower()}"
    return None


def category_color_for_index(index: int) -> str:
    return CATEGORY_COLOR_PALETTE[index % len(CATEGORY_COLOR_PALETTE)]


def resolved_category_color(cat: BankingCategory | None) -> str:
    """Color mostrado en UI: reglas fijas por nombre; el resto usa coral (#ff7b72)."""
    if cat is None:
        return _BANK_CAT_DEFAULT
    fixed = _canonical_hex_for_banking_category_name(getattr(cat, "name", None))
    if fixed:
        return fixed
    return _BANK_CAT_DEFAULT


def backfill_banking_category_colors(db: Session) -> None:
    """Asigna color de paleta a categorías sin hex guardado."""
    changed = False
    for c in db.query(BankingCategory).all():
        if _normalize_hex_color(getattr(c, "color", None)):
            continue
        c.color = category_color_for_index(c.sort_order)
        changed = True
    if changed:
        db.commit()
        logger.info("Backfill: color asignado en categorías bancarias")


def reconcile_banking_account_balance(db: Session, account_id: int) -> None:
    """
    Fija el saldo de la cuenta como opening_balance + suma de movimientos.
    Evita descuadres si un movimiento se eliminó sin ajuste incremental o hubo fallos previos.
    """
    acc = db.query(BankingAccount).filter(BankingAccount.id == account_id).first()
    if acc is None:
        return
    total = (
        db.query(func.coalesce(func.sum(BankingTransaction.amount), 0.0))
        .filter(BankingTransaction.account_id == account_id)
        .scalar()
    )
    acc.balance = float(acc.opening_balance) + float(total or 0)


def get_pago_tarjeta_credito_cat_sub_ids(db: Session, user_id: int) -> tuple[int, int]:
    """Ids de categoría/sub «Pago Tarjeta de Credito» (plantilla 20 / 2001)."""
    cat = (
        db.query(BankingCategory)
        .filter(
            BankingCategory.user_id == user_id,
            BankingCategory.template_cat_id == TEMPLATE_CAT_PAGO_TARJETA_CREDITO,
        )
        .first()
    )
    if not cat:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falta la categoría interna «Pago Tarjeta de Credito». Vuelve a cargar la app o sincroniza categorías.",
        )
    sub = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.category_id == cat.id,
            BankingSubcategory.template_sub_id == TEMPLATE_SUB_PAGO_TARJETA_CREDITO,
        )
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falta la subcategoría interna «Pago Tarjeta de Credito».",
        )
    return int(cat.id), int(sub.id)


def _delete_cc_payment_transactions_for_charge(db: Session, user_id: int, cc_charge_id: int) -> set[int]:
    """Elimina egresos en cuenta corriente con `peer_transaction_id` = cargo TC."""
    rows = (
        db.query(BankingTransaction)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.peer_transaction_id == cc_charge_id,
        )
        .all()
    )
    account_ids: set[int] = set()
    for r in rows:
        account_ids.add(int(r.account_id))
        r.peer_transaction_id = None
        db.delete(r)
    return account_ids


def sync_credit_card_payment_mirror(
    db: Session,
    user_id: int,
    cc_tx: BankingTransaction,
) -> None:
    """
    Al marcar pagado un cargo en tarjeta de crédito, crea un egreso negativo en la cuenta corriente
    asociada (categoría Pago Tarjeta de Credito). Al desmarcar, elimina ese movimiento.
    """
    acc = get_account_for_user(db, user_id, cc_tx.account_id)
    if not acc:
        return
    pt = getattr(acc, "product_type", None)

    if pt != "tarjeta_credito":
        deleted = _delete_cc_payment_transactions_for_charge(db, user_id, cc_tx.id)
        for aid in deleted:
            reconcile_banking_account_balance(db, aid)
        return

    now_paid = bool(cc_tx.credit_card_charge_paid)

    if not now_paid:
        deleted = _delete_cc_payment_transactions_for_charge(db, user_id, cc_tx.id)
        for aid in deleted:
            reconcile_banking_account_balance(db, aid)
        return

    linked_id = getattr(acc, "linked_checking_account_id", None)
    if not linked_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Configura la cuenta corriente asociada a esta tarjeta para registrar el pago del cargo.",
        )

    chk = get_account_for_user(db, user_id, int(linked_id))
    if not chk or not getattr(chk, "enabled", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cuenta corriente asociada no está disponible.",
        )
    validate_linked_checking_for_credit_card(
        db,
        user_id,
        bank_sbif=str(getattr(acc, "bank_sbif", "") or ""),
        linked_checking_account_id=int(linked_id),
        exclude_account_id=acc.id,
    )

    cat_id, sub_id = get_pago_tarjeta_credito_cat_sub_ids(db, user_id)

    existing = (
        db.query(BankingTransaction)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.peer_transaction_id == cc_tx.id,
            BankingTransaction.account_id == int(linked_id),
        )
        .first()
    )

    amt_out = -abs(float(cc_tx.amount))
    desc_src = (cc_tx.description or "").strip()
    pay_desc = f"Pago TC — {desc_src}" if desc_src else "Pago Tarjeta de Credito"
    # El egreso en cuenta corriente debe reflejar el día en que se marca pagado el cargo, no la fecha del consumo.
    pay_fecha = _banking_today_cl()
    acct_m = first_day_of_month_calendar(pay_fecha)
    now_ts = datetime.now(timezone.utc).replace(tzinfo=None)

    if existing:
        existing.amount = amt_out
        existing.fecha = pay_fecha
        existing.description = pay_desc
        existing.accounting_month = acct_m
        existing.category_id = cat_id
        existing.subcategory_id = sub_id
        db.flush()
        reconcile_banking_account_balance(db, int(linked_id))
        return

    pay = BankingTransaction(
        user_id=user_id,
        account_id=int(linked_id),
        fecha=pay_fecha,
        amount=amt_out,
        description=pay_desc,
        category_id=cat_id,
        subcategory_id=sub_id,
        created_at=now_ts,
        is_shared=False,
        split_participants=None,
        shared_expense_settled=False,
        credit_card_charge_paid=None,
        accounting_month=acct_m,
        status="posted",
        peer_transaction_id=cc_tx.id,
    )
    db.add(pay)
    db.flush()
    reconcile_banking_account_balance(db, int(linked_id))


def repair_phantom_negative_balances_for_user(db: Session, user_id: int) -> int:
    """
    Cuentas con saldo < 0 y cero movimientos: el descuadre quedó en `opening_balance` (p. ej. al borrar
    un movimiento sin alinear el saldo). Pone apertura y saldo en 0. No modifica cuentas con movimientos.
    """
    r = db.execute(
        text(
            """
            UPDATE banking_accounts
            SET opening_balance = 0.0, balance = 0.0
            WHERE user_id = :uid
            AND CAST(balance AS REAL) < 0
            AND NOT EXISTS (
                SELECT 1 FROM banking_transactions bt
                WHERE bt.account_id = banking_accounts.id
            )
            """
        ),
        {"uid": user_id},
    )
    rc = getattr(r, "rowcount", None)
    n = 0 if rc is None or rc < 0 else int(rc)
    if n > 0:
        db.commit()
        logger.info(
            "Reparación saldos: %s cuenta(s) sin movimientos con saldo negativo pasadas a 0",
            n,
        )
    return n


def sync_user_categories_from_json(
    db: Session, user_id: int, *, reset_sort_order_from_json: bool = False
) -> None:
    """
    Alinea categorías/subcategorías con `categorias_banking_default.json` (nombres, ids plantilla).

    Si `reset_sort_order_from_json` es True, el orden del listado pasa a ser el del archivo.
    Si es False (uso habitual), **no** se toca `sort_order` salvo en filas nuevas (se añaden al final).
    """
    raw = _load_default_categories_json()
    if not raw:
        if not _DEFAULT_CATEGORIES_PATH.is_file():
            logger.warning("Falta %s — no se pueden sincronizar categorías bancarias.", _DEFAULT_CATEGORIES_PATH)
        return

    all_user_cats = db.query(BankingCategory).filter(BankingCategory.user_id == user_id).all()
    by_tpl_cat: dict[int, BankingCategory] = {}
    by_name_lower: dict[str, BankingCategory] = {}
    for c in sorted(all_user_cats, key=lambda x: x.id):
        tc = getattr(c, "template_cat_id", None)
        if tc is not None:
            ik = int(tc)
            if ik not in by_tpl_cat:
                by_tpl_cat[ik] = c
        nl = c.name.strip().lower()
        if nl not in by_name_lower:
            by_name_lower[nl] = c

    max_sort = db.query(func.max(BankingCategory.sort_order)).filter(BankingCategory.user_id == user_id).scalar()
    next_sort = int(max_sort) + 1 if max_sort is not None else 0

    cat_pos = 0
    for cat in raw:
        if not isinstance(cat, dict):
            continue
        name = (cat.get("name") or "").strip()
        if not name:
            continue
        tpl_id = _parse_template_id(cat.get("id"))

        bc: BankingCategory | None = None
        if tpl_id is not None:
            bc = by_tpl_cat.get(tpl_id)
        if bc is None:
            bc = by_name_lower.get(name.lower())

        if bc is None:
            col = _normalize_hex_color(cat.get("color")) or category_color_for_index(next_sort)
            bc = BankingCategory(
                user_id=user_id,
                template_cat_id=tpl_id,
                name=name,
                sort_order=next_sort,
                color=col,
                names_locked=True,
                enabled=True,
            )
            db.add(bc)
            db.flush()
            next_sort += 1
            by_name_lower[name.lower()] = bc
            if tpl_id is not None:
                by_tpl_cat[tpl_id] = bc
        else:
            bc.name = name
            if tpl_id is not None:
                if bc.template_cat_id != tpl_id:
                    bc.template_cat_id = tpl_id
                by_tpl_cat[tpl_id] = bc

        if reset_sort_order_from_json:
            bc.sort_order = cat_pos
            cat_pos += 1

        subs_raw = cat.get("subcategories") if isinstance(cat.get("subcategories"), list) else []
        db_subs = (
            db.query(BankingSubcategory)
            .filter(BankingSubcategory.category_id == bc.id)
            .order_by(BankingSubcategory.sort_order, BankingSubcategory.id)
            .all()
        )
        by_tpl_sub: dict[int, BankingSubcategory] = {}
        by_sub_name: dict[str, BankingSubcategory] = {}
        for s in sorted(db_subs, key=lambda x: x.id):
            if s.template_sub_id is not None:
                stk = int(s.template_sub_id)
                if stk not in by_tpl_sub:
                    by_tpl_sub[stk] = s
            snl = s.name.strip().lower()
            if snl not in by_sub_name:
                by_sub_name[snl] = s

        sub_pos = 0
        for sraw in subs_raw:
            if not isinstance(sraw, dict):
                continue
            sn = (sraw.get("name") or "").strip()
            if not sn:
                continue
            sub_tid = _parse_template_id(sraw.get("id"))
            bs: BankingSubcategory | None = None
            if sub_tid is not None:
                bs = by_tpl_sub.get(sub_tid)
            if bs is None:
                bs = by_sub_name.get(sn.lower())
            if bs is None:
                if reset_sort_order_from_json:
                    next_so = sub_pos
                else:
                    max_so = (
                        db.query(func.coalesce(func.max(BankingSubcategory.sort_order), -1))
                        .filter(BankingSubcategory.category_id == bc.id)
                        .scalar()
                    )
                    next_so = int(max_so) + 1
                ns = BankingSubcategory(
                    user_id=user_id,
                    category_id=bc.id,
                    name=sn,
                    template_sub_id=sub_tid,
                    enabled=True,
                    sort_order=next_so,
                )
                db.add(ns)
                db.flush()
                by_sub_name[sn.lower()] = ns
                if sub_tid is not None:
                    by_tpl_sub[sub_tid] = ns
                bs = ns
            else:
                bs.name = sn
                if getattr(bs, "user_id", None) != user_id:
                    bs.user_id = user_id
                if sub_tid is not None and bs.template_sub_id != sub_tid:
                    bs.template_sub_id = sub_tid
                    by_tpl_sub[sub_tid] = bs
            if reset_sort_order_from_json:
                bs.sort_order = sub_pos
                sub_pos += 1

    _realign_bank_subcategories_by_template(db, user_id, raw)
    db.commit()


def repair_suscripciones_provisiones_duplicated_tpl(db: Session, user_id: int) -> None:
    """
    Antes del JSON corregido, Suscripciones y Provisiones compartían template_cat_id 21 y subs 2101–2106 con 2101.
    Tras separar Suscripciones como plantilla 22 / subs 220x, mueve subs mal colgadas de Provisiones (21) a Suscripciones (22).
    Si el sync ya creó filas duplicadas en Suscripciones (2202–2206), borra la vacía sin movimientos.
    """
    prov = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.template_cat_id == 21)
        .first()
    )
    sus = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.template_cat_id == 22)
        .first()
    )
    if prov is None or sus is None:
        return

    # La plantilla actual ya no incluye 2206: 2106 (legado) se absorbe en 2205.
    moves = [(2102, 2202), (2103, 2203), (2104, 2204), (2105, 2205)]
    for old_tid, new_tid in moves:
        s_old = (
            db.query(BankingSubcategory)
            .filter(
                BankingSubcategory.user_id == user_id,
                BankingSubcategory.category_id == prov.id,
                BankingSubcategory.template_sub_id == old_tid,
            )
            .first()
        )
        if s_old is None:
            continue
        s_new = (
            db.query(BankingSubcategory)
            .filter(
                BankingSubcategory.user_id == user_id,
                BankingSubcategory.category_id == sus.id,
                BankingSubcategory.template_sub_id == new_tid,
            )
            .first()
        )
        if s_new is not None and s_new.id != s_old.id:
            n_dup = (
                db.query(func.count(BankingTransaction.id))
                .filter(BankingTransaction.subcategory_id == s_new.id)
                .scalar()
                or 0
            )
            if int(n_dup) == 0:
                db.delete(s_new)
                db.flush()
        s_old.category_id = sus.id
        s_old.template_sub_id = new_tid
    s_2106 = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.category_id == prov.id,
            BankingSubcategory.template_sub_id == 2106,
        )
        .first()
    )
    t_2205 = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.category_id == sus.id,
            BankingSubcategory.template_sub_id == 2205,
        )
        .first()
    )
    if s_2106 is not None and t_2205 is not None:
        db.query(BankingTransaction).filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.subcategory_id == s_2106.id,
        ).update(
            {"subcategory_id": t_2205.id, "category_id": sus.id},
            synchronize_session=False,
        )
        db.delete(s_2106)
        db.flush()
    db.commit()


def _ensure_template_subcategories_complete(db: Session, user_id: int) -> None:
    """
    Por cada categoría plantilla del JSON, asegura una subcategoría por id de plantilla.
    Corrige filas huéridas (mismo template_sub_id en otra categoría) y crea las que falten.
    """
    raw = _load_default_categories_json()
    if not raw:
        return
    changed = False
    for cat in raw:
        if not isinstance(cat, dict):
            continue
        tpl_id = _parse_template_id(cat.get("id"))
        if tpl_id is None:
            continue
        bc = (
            db.query(BankingCategory)
            .filter(BankingCategory.user_id == user_id, BankingCategory.template_cat_id == tpl_id)
            .first()
        )
        if bc is None:
            continue
        subs_raw = cat.get("subcategories") if isinstance(cat.get("subcategories"), list) else []
        for sraw in subs_raw:
            if not isinstance(sraw, dict):
                continue
            sn = (sraw.get("name") or "").strip()
            if not sn:
                continue
            stid = _parse_template_id(sraw.get("id"))
            if stid is None:
                continue
            stid_int = int(stid)
            existing = (
                db.query(BankingSubcategory)
                .filter(
                    BankingSubcategory.user_id == user_id,
                    BankingSubcategory.template_sub_id == stid_int,
                )
                .first()
            )
            if existing is not None:
                if existing.category_id != bc.id:
                    db.query(BankingTransaction).filter(
                        BankingTransaction.user_id == user_id,
                        BankingTransaction.subcategory_id == existing.id,
                    ).update(
                        {"category_id": bc.id},
                        synchronize_session=False,
                    )
                    existing.category_id = bc.id
                    changed = True
                if existing.name != sn:
                    existing.name = sn
                    changed = True
                continue
            max_so = (
                db.query(func.coalesce(func.max(BankingSubcategory.sort_order), -1))
                .filter(
                    BankingSubcategory.category_id == bc.id,
                    BankingSubcategory.user_id == user_id,
                )
                .scalar()
            )
            next_so = int(max_so) + 1
            db.add(
                BankingSubcategory(
                    user_id=user_id,
                    category_id=bc.id,
                    name=sn,
                    template_sub_id=stid_int,
                    enabled=True,
                    sort_order=next_so,
                )
            )
            changed = True
        db.flush()
    if changed:
        db.commit()


def ensure_default_categories(
    db: Session, user_id: int, *, reset_sort_order_from_json: bool = False
) -> None:
    dedupe_banking_catalog_for_user(db, user_id)
    sync_user_categories_from_json(db, user_id, reset_sort_order_from_json=reset_sort_order_from_json)
    repair_suscripciones_provisiones_duplicated_tpl(db, user_id)
    _prune_bank_subcategories_not_in_default_json(db, user_id)
    _ensure_template_subcategories_complete(db, user_id)


def get_user_provisiones_default_category_subcategory(db: Session, user_id: int) -> tuple[int, int]:
    """Primera categoría plantilla Provisiones (21) y su primera subcategoría habilitada."""
    ensure_default_categories(db, user_id)
    cat = (
        db.query(BankingCategory)
        .filter(
            BankingCategory.user_id == user_id,
            BankingCategory.template_cat_id == TEMPLATE_CAT_PROVISIONES,
        )
        .order_by(BankingCategory.sort_order, BankingCategory.id)
        .first()
    )
    if not cat:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se encontró la categoría Provisiones. Recarga la página o revisa el catálogo bancario.",
        )
    sub = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.category_id == cat.id,
        )
        .order_by(BankingSubcategory.sort_order, BankingSubcategory.id)
        .first()
    )
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="La categoría Provisiones no tiene subcategorías.",
        )
    return int(cat.id), int(sub.id)


def register_bank_movements_from_personal_provision_items(
    db: Session,
    user_id: int,
    *,
    accounting_month: date,
    item_ids: list[int],
) -> tuple[int, int, list[str]]:
    """
    Crea movimientos bancarios en categoría Provisiones, monto negativo = egreso,
    referencia al monto del ítem personal. Tarjeta de crédito: cargo marcado como no pagado.
    Fecha del movimiento = hoy (Chile); mes contable = el elegido por el usuario.
    """
    cat_id, sub_id = get_user_provisiones_default_category_subcategory(db, user_id)
    am = first_day_of_month_calendar(accounting_month)
    fecha_hoy = _banking_today_cl()
    seen: set[int] = set()
    created = 0
    skipped = 0
    messages: list[str] = []

    for raw_id in item_ids:
        if raw_id in seen:
            continue
        seen.add(raw_id)
        row = (
            db.query(BankingPersonalProvisionItem)
            .filter(
                BankingPersonalProvisionItem.id == raw_id,
                BankingPersonalProvisionItem.user_id == user_id,
            )
            .first()
        )
        if not row:
            skipped += 1
            messages.append(f"Ítem {raw_id}: no encontrado.")
            continue
        desc_short = (str(row.description).strip() or "Sin descripción")[:48]
        if row.account_id is None:
            skipped += 1
            messages.append(f"«{desc_short}»: falta cuenta asociada en el recordatorio.")
            continue
        if row.amount_clp is None or float(row.amount_clp) == 0.0:
            skipped += 1
            messages.append(f"«{desc_short}»: el monto de referencia debe ser distinto de cero.")
            continue

        amt = -abs(float(row.amount_clp))
        base = str(row.description).strip() or "Provisión"
        lab = getattr(row, "category_label", None)
        lab_s = lab.strip() if isinstance(lab, str) else ""
        description = f"{base} ({lab_s})" if lab_s else base

        acc = get_account_for_user(db, user_id, int(row.account_id))
        pt = getattr(acc, "product_type", None) if acc else None
        cc_paid = False if pt == "tarjeta_credito" else None

        try:
            create_transaction_row(
                db,
                user_id,
                account_id=int(row.account_id),
                fecha=fecha_hoy,
                amount=amt,
                description=description,
                category_id=cat_id,
                subcategory_id=sub_id,
                credit_card_charge_paid=cc_paid,
                accounting_month=am,
            )
            created += 1
        except HTTPException as e:
            skipped += 1
            detail = e.detail
            if isinstance(detail, list):
                detail_s = "; ".join(str(x) for x in detail)
            else:
                detail_s = str(detail)
            messages.append(f"«{desc_short}»: {detail_s}")

    return created, skipped, messages


def reapply_banking_template_all_users(
    db: Session, *, reset_sort_order_from_json: bool = False
) -> None:
    """
    Reinyecta `categorias_banking_default.json` para todos los usuarios con datos bancarios.
    Por defecto **no** resetea el orden manual; pasa `reset_sort_order_from_json=True` para imponer el orden del archivo.
    """
    ids: set[int] = {row[0] for row in db.query(BankingCategory.user_id).distinct()}
    ids |= {row[0] for row in db.query(BankingTransaction.user_id).distinct()}
    for uid in sorted(ids):
        ensure_default_categories(db, uid, reset_sort_order_from_json=reset_sort_order_from_json)
    if ids:
        logger.info(
            "Plantilla bancaria reaplicada desde JSON (%s usuario(s)) — categorías/subcategorías según archivo.",
            len(ids),
        )


def reset_banking_catalog_from_json_fresh(db: Session) -> None:
    """
    Desarrollo: vacía `banking_transactions`, `banking_subcategories` y `banking_categories`
    y vuelve a crear el catálogo desde `categorias_banking_default.json` para **cada** usuario
    (User). Así se evita estado heredado con ids o `user_id` incoherentes.

    **Borra todos los movimientos bancarios**; no toca `banking_accounts`.
    Activar con `RESET_BANKING_CATALOG_ON_STARTUP=1` (p. ej. en `.env`).
    """
    from models import User

    db.execute(text("DELETE FROM banking_transactions"))
    db.execute(text("DELETE FROM banking_subcategories"))
    db.execute(text("DELETE FROM banking_categories"))
    db.commit()

    uids = [int(r[0]) for r in db.query(User.id).order_by(User.id).all()]
    for uid in uids:
        ensure_default_categories(db, uid, reset_sort_order_from_json=True)
    logger.warning(
        "RESET_BANKING_CATALOG: movimientos bancarios y catálogo eliminados; repoblado desde JSON "
        "para %s usuario(s). Sincroniza saldos de cuentas si hace falta.",
        len(uids),
    )


def category_transaction_counts(db: Session, user_id: int) -> dict[int, int]:
    rows = (
        db.query(BankingTransaction.category_id, func.count(BankingTransaction.id))
        .filter(BankingTransaction.user_id == user_id)
        .group_by(BankingTransaction.category_id)
        .all()
    )
    return {int(cid): int(n) for cid, n in rows}


def subcategory_transaction_counts(db: Session, user_id: int) -> dict[int, int]:
    rows = (
        db.query(BankingTransaction.subcategory_id, func.count(BankingTransaction.id))
        .filter(BankingTransaction.user_id == user_id)
        .group_by(BankingTransaction.subcategory_id)
        .all()
    )
    return {int(sid): int(n) for sid, n in rows}


def backfill_banking_subcategory_template_ids(db: Session) -> None:
    """Opcional: rellena template_sub_id desde el JSON si falta (referencia, no validación)."""
    if not _DEFAULT_CATEGORIES_PATH.is_file():
        return
    n_null = (
        db.query(func.count(BankingSubcategory.id))
        .filter(BankingSubcategory.template_sub_id.is_(None))
        .scalar()
        or 0
    )
    if n_null == 0:
        return
    raw = json.loads(_DEFAULT_CATEGORIES_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        return
    tpl_map: dict[tuple[str, str], int] = {}
    for cat in raw:
        if not isinstance(cat, dict):
            continue
        cn = (cat.get("name") or "").strip().lower()
        for s in cat.get("subcategories") or []:
            if not isinstance(s, dict):
                continue
            sn = (s.get("name") or "").strip().lower()
            sid = s.get("id")
            if not sn:
                continue
            tid = int(sid) if isinstance(sid, int) or (isinstance(sid, str) and str(sid).isdigit()) else None
            if tid is None:
                continue
            tpl_map[(cn, sn)] = tid

    q = (
        db.query(BankingSubcategory, BankingCategory)
        .join(BankingCategory, BankingSubcategory.category_id == BankingCategory.id)
        .filter(BankingSubcategory.template_sub_id.is_(None))
    )
    updated = 0
    for bs, bc in q.all():
        key = (bc.name.strip().lower(), bs.name.strip().lower())
        tid = tpl_map.get(key)
        if tid is not None:
            bs.template_sub_id = tid
            updated += 1
    if updated:
        db.commit()
        logger.info("Backfill: template_sub_id asignado en %s subcategorías bancarias", updated)


def get_account_for_user(db: Session, user_id: int, account_id: int) -> BankingAccount | None:
    return (
        db.query(BankingAccount)
        .filter(BankingAccount.user_id == user_id, BankingAccount.id == account_id)
        .first()
    )


def load_bancos_chile() -> list[dict[str, Any]]:
    if not _BANKS_CHILE_PATH.is_file():
        return []
    raw = json.loads(_BANKS_CHILE_PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else []


def bank_name_for_sbif(sbif: str | None) -> str | None:
    if not sbif:
        return None
    s = str(sbif).strip()
    for row in load_bancos_chile():
        if str(row.get("sbif", "")).strip() == s:
            out = str(row.get("name", "")).strip()
            return out or None
    return None


def is_valid_bank_sbif(sbif: str) -> bool:
    return bank_name_for_sbif(sbif) is not None


def banking_transaction_counts_by_account(db: Session, user_id: int) -> dict[int, int]:
    rows = (
        db.query(BankingTransaction.account_id, func.count(BankingTransaction.id))
        .filter(BankingTransaction.user_id == user_id)
        .group_by(BankingTransaction.account_id)
        .all()
    )
    return {int(aid): int(n) for aid, n in rows}


def banking_sum_amounts_by_account(
    db: Session, user_id: int, *, through_current_accounting_month: bool = False
) -> dict[int, float]:
    """
    Suma de `amount` por cuenta. Si `through_current_accounting_month`, solo movimientos
    cuyo mes contable efectivo no supera el mes en curso (Chile) — alinea saldos con cierre de mes.
    """
    q = (
        db.query(BankingTransaction.account_id, func.coalesce(func.sum(BankingTransaction.amount), 0.0))
        .filter(BankingTransaction.user_id == user_id)
    )
    if through_current_accounting_month:
        q = q.filter(banking_filter_transactions_through_current_accounting_month(db))
    rows = q.group_by(BankingTransaction.account_id).all()
    return {int(aid): float(s or 0.0) for aid, s in rows}


def banking_sum_unpaid_credit_card_charges_clp(
    db: Session, user_id: int, *, through_current_accounting_month: bool = False
) -> float:
    """
    Suma de «deuda» pendiente en TC: egresos (amount < 0) con cargo no marcado como pagado.
    """
    unpaid = or_(
        BankingTransaction.credit_card_charge_paid.is_(False),
        BankingTransaction.credit_card_charge_paid.is_(None),
    )
    q = (
        db.query(func.coalesce(func.sum(-BankingTransaction.amount), 0.0))
        .join(BankingAccount, BankingAccount.id == BankingTransaction.account_id)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingAccount.user_id == user_id,
            BankingAccount.product_type == "tarjeta_credito",
            BankingTransaction.amount < 0,
            unpaid,
        )
    )
    if through_current_accounting_month:
        q = q.filter(banking_filter_transactions_through_current_accounting_month(db))
    total = q.scalar()
    return float(total or 0.0)


def banking_sum_shared_unsettled_clp(db: Session, user_id: int) -> float:
    """
    Neto de gastos compartidos sin liquidar en «cuota por persona», con signo del movimiento.

    Por movimiento se usa (monto / participantes): egresos negativos suman deuda neta; ingresos o
    devoluciones positivos restan. El valor devuelto es ``-sum(monto/n)``, de modo que —como antes—
    predominan números positivos cuando hay gastos netos (convención de la tarjeta «Deuda»).
    """
    rows = (
        db.query(BankingTransaction)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.is_shared.is_(True),
            BankingTransaction.shared_expense_settled.is_(False),
        )
        .all()
    )
    sum_signed_shares = 0.0
    for t in rows:
        n_raw = getattr(t, "split_participants", None)
        if n_raw is None or int(n_raw) < 1:
            n = 2
        else:
            n = int(n_raw)
        sum_signed_shares += float(t.amount) / float(n)
    # Tarjeta «Deuda»: signo opuesto a la suma contable de (monto/n). Gasto (monto<0) aporta positivo;
    # ingreso/devolución (monto>0) resta del total mostrado.
    return round(-sum_signed_shares, 4)


def banking_debt_totals_out(
    db: Session, user_id: int, *, through_current_accounting_month: bool = False
) -> dict[str, float]:
    return {
        "credit_card_unpaid_clp": banking_sum_unpaid_credit_card_charges_clp(
            db, user_id, through_current_accounting_month=through_current_accounting_month
        ),
        "shared_unsettled_clp": banking_sum_shared_unsettled_clp(db, user_id),
    }


def banking_apply_shared_transaction_scope(_db: Session, _user_id: int, q):
    """Limita la consulta a movimientos marcados como compartidos."""
    return q.filter(BankingTransaction.is_shared.is_(True))


def banking_shared_unsettled_groups_payload(db: Session, user_id: int) -> list[dict[str, Any]]:
    """
    Movimientos compartidos sin liquidar (shared_expense_settled false), un solo grupo para la UI.
    """
    txs = (
        db.query(BankingTransaction)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.is_shared.is_(True),
            BankingTransaction.shared_expense_settled.is_(False),
        )
        .order_by(
            BankingTransaction.fecha.desc(),
            BankingTransaction.created_at.desc(),
            BankingTransaction.id.desc(),
        )
        .all()
    )
    if not txs:
        return []
    return [
        {
            "account_id": 0,
            "account_name": "Compartidos pendientes de liquidar",
            "items": [transaction_to_out(db, t) for t in txs],
        }
    ]


def banking_bulk_set_shared_expense_settled(db: Session, user_id: int, transaction_ids: list[int]) -> int:
    """Marca como liquidados los movimientos compartidos indicados. Devuelve cantidad actualizada."""
    ids = list(dict.fromkeys(int(x) for x in transaction_ids))
    if not ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Indica al menos un movimiento.")
    txs = (
        db.query(BankingTransaction)
        .filter(BankingTransaction.user_id == user_id, BankingTransaction.id.in_(ids))
        .all()
    )
    found = {int(t.id) for t in txs}
    missing = set(ids) - found
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Movimientos no encontrados o no tuyos: {sorted(missing)}",
        )
    not_shared = [int(t.id) for t in txs if not bool(getattr(t, "is_shared", False))]
    if not_shared:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Estos movimientos no son compartidos: {sorted(not_shared)}",
        )
    n = 0
    d_liquidacion = _banking_today_cl()
    acct_liq = first_day_of_month_calendar(d_liquidacion)
    for t in txs:
        if not bool(getattr(t, "shared_expense_settled", False)):
            t.shared_expense_settled = True
            t.fecha = d_liquidacion
            t.accounting_month = acct_liq
            n += 1
    db.commit()
    return n


def banking_apply_provision_transaction_scope(_db: Session, _user_id: int, q):
    """Solo movimientos cuya categoría es plantilla Provisiones (21) o nombre «Provisiones»."""
    prov_cat = or_(
        BankingCategory.template_cat_id == TEMPLATE_CAT_PROVISIONES,
        func.lower(func.trim(BankingCategory.name)) == "provisiones",
    )
    return q.join(BankingCategory, BankingCategory.id == BankingTransaction.category_id).filter(
        BankingCategory.user_id == _user_id,
        prov_cat,
    )


def _provision_expected_reversal_description(orig: BankingTransaction) -> str:
    orig_desc = (orig.description or "").strip()
    return ("Reversa - " + orig_desc) if orig_desc else "Reversa -"


def banking_provisions_pending_reversal_groups_payload(db: Session, user_id: int) -> list[dict[str, Any]]:
    """
    Movimientos de categoría Provisiones que no son reversas automáticas y sin reversa pareja registrada,
    agrupados por cuenta (orden por nombre de cuenta).

    Implementación en O(n): una pasada para indexar reversas por (cuenta, categoría, sub, monto) + descripción,
    sin N consultas por movimiento (importante en producción con historial largo).
    """
    prov_cat = or_(
        BankingCategory.template_cat_id == TEMPLATE_CAT_PROVISIONES,
        func.lower(func.trim(BankingCategory.name)) == "provisiones",
    )
    txs = (
        db.query(BankingTransaction)
        .join(BankingCategory, BankingCategory.id == BankingTransaction.category_id)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingCategory.user_id == user_id,
            prov_cat,
        )
        .order_by(
            BankingTransaction.fecha.desc(),
            BankingTransaction.created_at.desc(),
            BankingTransaction.id.desc(),
        )
        .all()
    )
    tpl_rows = (
        db.query(BankingCategory.id, BankingCategory.template_cat_id)
        .filter(BankingCategory.user_id == user_id)
        .all()
    )
    tpl_by_cat: dict[int, int | None] = {int(cid): (int(tid) if tid is not None else None) for cid, tid in tpl_rows}

    def is_provision_reversal_row(tx: BankingTransaction) -> bool:
        desc = (tx.description or "").strip()
        if not desc.startswith("Reversa -"):
            return False
        tid = tpl_by_cat.get(int(tx.category_id))
        return tid is not None and int(tid) == TEMPLATE_CAT_PROVISIONES

    # Clave: cuenta + categoría + sub + monto (de la fila reversa); valores: descripciones exactas de reversas
    rev_desc_by_key: dict[tuple[int, int, int, float], set[str]] = {}
    for tx in txs:
        if not is_provision_reversal_row(tx):
            continue
        key = (
            int(tx.account_id),
            int(tx.category_id),
            int(tx.subcategory_id),
            round(float(tx.amount), 4),
        )
        rev_desc_by_key.setdefault(key, set()).add((tx.description or "").strip())

    pending: list[BankingTransaction] = []
    for tx in txs:
        if is_provision_reversal_row(tx):
            continue
        if abs(float(tx.amount)) < 1e-12:
            continue
        expected = _provision_expected_reversal_description(tx)
        lookup_key = (
            int(tx.account_id),
            int(tx.category_id),
            int(tx.subcategory_id),
            round(-float(tx.amount), 4),
        )
        if expected in rev_desc_by_key.get(lookup_key, set()):
            continue
        pending.append(tx)

    by_acc: dict[int, list[BankingTransaction]] = {}
    for tx in pending:
        aid = int(tx.account_id)
        by_acc.setdefault(aid, []).append(tx)
    names: dict[int, str] = {}
    for aid in by_acc:
        acc = get_account_for_user(db, user_id, aid)
        names[aid] = acc.name.strip() if acc else ""
    out: list[dict[str, Any]] = []
    for aid in sorted(by_acc.keys(), key=lambda i: (names.get(i, "").lower(), i)):
        out.append(
            {
                "account_id": aid,
                "account_name": names.get(aid, ""),
                "items": [transaction_to_out(db, t) for t in by_acc[aid]],
            }
        )
    return out


def banking_bulk_reverse_provision(db: Session, user_id: int, transaction_ids: list[int]) -> int:
    """Ejecuta reverse_provision por cada id único; cuenta éxitos (omitidos si HTTPException)."""
    seen: set[int] = set()
    n = 0
    for raw in transaction_ids:
        tid = int(raw)
        if tid in seen:
            continue
        seen.add(tid)
        try:
            reverse_provision_transaction_row(db, user_id, tid)
            n += 1
        except HTTPException:
            continue
    return n


def banking_apply_credit_card_transaction_scope(db: Session, user_id: int, q):
    """
    Limita la consulta a movimientos en cuenta tarjeta de crédito o egresos categoría «Pago Tarjeta de Credito».
    """
    tc_ids = [
        int(r[0])
        for r in db.query(BankingAccount.id)
        .filter(BankingAccount.user_id == user_id, BankingAccount.product_type == "tarjeta_credito")
        .all()
    ]
    pago_cat_ids = [
        int(r[0])
        for r in db.query(BankingCategory.id)
        .filter(
            BankingCategory.user_id == user_id,
            BankingCategory.template_cat_id == TEMPLATE_CAT_PAGO_TARJETA_CREDITO,
        )
        .all()
    ]
    parts = []
    if tc_ids:
        parts.append(BankingTransaction.account_id.in_(tc_ids))
    if pago_cat_ids:
        parts.append(BankingTransaction.category_id.in_(pago_cat_ids))
    if not parts:
        return q.filter(sql_false())
    return q.filter(or_(*parts))


def banking_credit_card_unpaid_groups_payload(
    db: Session, user_id: int, *, through_current_accounting_month: bool = False
) -> list[dict[str, Any]]:
    """
    Cargos TC sin marcar pagados (egresos), agrupados por cuenta tarjeta.
    Cada grupo incluye movimientos ordenados por fecha descendente.
    """
    unpaid = or_(
        BankingTransaction.credit_card_charge_paid.is_(False),
        BankingTransaction.credit_card_charge_paid.is_(None),
    )
    q = (
        db.query(BankingTransaction)
        .join(BankingAccount, BankingAccount.id == BankingTransaction.account_id)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingAccount.user_id == user_id,
            BankingAccount.product_type == "tarjeta_credito",
            BankingTransaction.amount < 0,
            unpaid,
        )
    )
    if through_current_accounting_month:
        q = q.filter(banking_filter_transactions_through_current_accounting_month(db))
    txs = q.order_by(
        BankingTransaction.fecha.desc(),
        BankingTransaction.created_at.desc(),
        BankingTransaction.id.desc(),
    ).all()
    by_acc: dict[int, list[BankingTransaction]] = {}
    for tx in txs:
        aid = int(tx.account_id)
        by_acc.setdefault(aid, []).append(tx)
    names: dict[int, str] = {}
    for aid in by_acc:
        acc = get_account_for_user(db, user_id, aid)
        names[aid] = acc.name.strip() if acc else ""
    out: list[dict[str, Any]] = []
    for aid in sorted(by_acc.keys(), key=lambda i: (names.get(i, "").lower(), i)):
        out.append(
            {
                "account_id": aid,
                "account_name": names.get(aid, ""),
                "items": [transaction_to_out(db, t) for t in by_acc[aid]],
            }
        )
    return out


def banking_provision_sum_by_account(
    db: Session, user_id: int, *, through_current_accounting_month: bool = False
) -> dict[int, float]:
    """
    Suma de `amount` por cuenta para movimientos cuya categoría es plantilla Provisiones (21),
    o con nombre «Provisiones» (p. ej. legado sin `template_cat_id`).
    Incluye reversas (netean). Negativo = egresos provisionados netos.
    """
    prov_cat = or_(
        BankingCategory.template_cat_id == TEMPLATE_CAT_PROVISIONES,
        func.lower(func.trim(BankingCategory.name)) == "provisiones",
    )
    q = (
        db.query(BankingTransaction.account_id, func.coalesce(func.sum(BankingTransaction.amount), 0.0))
        .join(BankingCategory, BankingCategory.id == BankingTransaction.category_id)
        .filter(BankingTransaction.user_id == user_id, BankingCategory.user_id == user_id, prov_cat)
    )
    if through_current_accounting_month:
        q = q.filter(banking_filter_transactions_through_current_accounting_month(db))
    rows = q.group_by(BankingTransaction.account_id).all()
    return {int(aid): float(s or 0.0) for aid, s in rows}


def banking_account_to_out(
    db: Session,
    user_id: int,
    acc: BankingAccount,
    *,
    tx_counts: dict[int, int] | None = None,
    provision_sums: dict[int, float] | None = None,
    book_balance: float | None = None,
) -> dict[str, Any]:
    bs = getattr(acc, "bank_sbif", None)
    bank_name = bank_name_for_sbif(bs)
    linked_id = getattr(acc, "linked_checking_account_id", None)
    linked_name = None
    if linked_id is not None:
        link = (
            db.query(BankingAccount)
            .filter(BankingAccount.user_id == user_id, BankingAccount.id == linked_id)
            .first()
        )
        linked_name = link.name if link else None
    if tx_counts is not None:
        n_tx = int(tx_counts.get(acc.id, 0))
    else:
        n_tx = (
            db.query(func.count(BankingTransaction.id))
            .filter(
                BankingTransaction.user_id == user_id,
                BankingTransaction.account_id == acc.id,
            )
            .scalar()
            or 0
        )
        n_tx = int(n_tx)
    bal = float(book_balance) if book_balance is not None else float(acc.balance)
    ps = float(provision_sums.get(acc.id, 0.0)) if provision_sums is not None else 0.0
    return {
        "id": acc.id,
        "name": acc.name,
        "currency": acc.currency,
        "balance": bal,
        "provision_net_sum": ps,
        "balance_at_bank": bal - ps,
        "product_type": getattr(acc, "product_type", None),
        "bank_sbif": bs,
        "bank_name": bank_name,
        "linked_checking_account_id": linked_id,
        "linked_checking_account_name": linked_name,
        "enabled": bool(getattr(acc, "enabled", True)),
        "include_in_total_balance": bool(getattr(acc, "include_in_total_balance", True)),
        "has_transactions": n_tx > 0,
    }


def validate_linked_checking_for_credit_card(
    db: Session,
    user_id: int,
    *,
    bank_sbif: str,
    linked_checking_account_id: int,
    exclude_account_id: int | None = None,
) -> None:
    linked = get_account_for_user(db, user_id, linked_checking_account_id)
    if not linked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La cuenta corriente asociada no existe.")
    if exclude_account_id is not None and linked.id == exclude_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La tarjeta no puede asociarse a sí misma.")
    pt = getattr(linked, "product_type", None)
    if pt != "cuenta_corriente":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cuenta asociada debe ser de tipo «Cuenta corriente».",
        )
    lb = str(getattr(linked, "bank_sbif", "") or "").strip()
    bb = bank_sbif.strip()
    if lb != bb:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cuenta corriente debe ser del mismo banco que la tarjeta.",
        )


def count_credit_cards_linked_to_checking(db: Session, user_id: int, checking_account_id: int) -> int:
    n = (
        db.query(func.count(BankingAccount.id))
        .filter(
            BankingAccount.user_id == user_id,
            BankingAccount.linked_checking_account_id == checking_account_id,
        )
        .scalar()
        or 0
    )
    return int(n)


def get_category_for_user(db: Session, user_id: int, category_id: int) -> BankingCategory | None:
    return (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.id == category_id)
        .first()
    )


def get_subcategory_for_user(db: Session, user_id: int, subcategory_id: int) -> BankingSubcategory | None:
    return (
        db.query(BankingSubcategory)
        .join(BankingCategory, BankingSubcategory.category_id == BankingCategory.id)
        .filter(
            BankingCategory.user_id == user_id,
            BankingSubcategory.user_id == user_id,
            BankingSubcategory.id == subcategory_id,
        )
        .first()
    )


def reorder_categories_for_user(db: Session, user_id: int, category_ids: list[int]) -> None:
    """
    Asigna sort_order 0..n-1 según el orden de `category_ids` (solo categorías visibles).
    Las categorías internas (plantilla reservada) conservan orden al final.
    """
    ensure_default_categories(db, user_id)
    rows = db.query(BankingCategory).filter(BankingCategory.user_id == user_id).all()

    def _is_internal(c: BankingCategory) -> bool:
        tid = getattr(c, "template_cat_id", None)
        return tid is not None and int(tid) in INTERNAL_BANKING_TEMPLATE_CAT_IDS

    visible = [c for c in rows if not _is_internal(c)]
    hidden = [c for c in rows if _is_internal(c)]

    visible_ids = {c.id for c in visible}
    incoming = list(category_ids)
    if len(incoming) != len(set(incoming)):
        raise HTTPException(status_code=400, detail="Hay ids duplicados en la lista")
    if set(incoming) != visible_ids or len(incoming) != len(visible_ids):
        raise HTTPException(
            status_code=400,
            detail="La lista debe incluir exactamente todas tus categorías visibles, sin faltantes ni sobrantes",
        )
    id_to_row = {c.id: c for c in rows}
    for i, cid in enumerate(incoming):
        id_to_row[cid].sort_order = i
    base = len(incoming)
    for j, c in enumerate(sorted(hidden, key=lambda x: (x.sort_order, x.id))):
        c.sort_order = base + j
    db.commit()


def reorder_subcategories_for_user(db: Session, user_id: int, category_id: int, subcategory_ids: list[int]) -> None:
    """Asigna sort_order 0..n-1 según el orden de `subcategory_ids` (todas las subs de esa categoría)."""
    ensure_default_categories(db, user_id)
    cat = get_category_for_user(db, user_id, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    rows = (
        db.query(BankingSubcategory)
        .filter(BankingSubcategory.category_id == category_id, BankingSubcategory.user_id == user_id)
        .all()
    )
    existing = {s.id for s in rows}
    incoming = list(subcategory_ids)
    if len(incoming) != len(set(incoming)):
        raise HTTPException(status_code=400, detail="Hay ids duplicados en la lista")
    if set(incoming) != existing or len(incoming) != len(existing):
        raise HTTPException(
            status_code=400,
            detail="La lista debe incluir exactamente todas las subcategorías de esta categoría",
        )
    id_to_row = {s.id: s for s in rows}
    for i, sid in enumerate(incoming):
        id_to_row[sid].sort_order = i
    db.commit()


def list_categories_nested(db: Session, user_id: int) -> list[dict[str, Any]]:
    cat_tx = category_transaction_counts(db, user_id)
    sub_tx = subcategory_transaction_counts(db, user_id)
    cats = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id)
        .order_by(BankingCategory.sort_order, BankingCategory.id)
        .all()
    )
    out: list[dict[str, Any]] = []
    for c in cats:
        internal_reserved = _category_is_internal_reserved(c)
        cn = cat_tx.get(c.id, 0)
        subs = (
            db.query(BankingSubcategory)
            .filter(
                BankingSubcategory.category_id == c.id,
                BankingSubcategory.user_id == user_id,
            )
            .order_by(BankingSubcategory.sort_order, BankingSubcategory.id)
            .all()
        )
        out.append(
            {
                "id": c.id,
                "name": c.name,
                "sort_order": c.sort_order,
                "color": resolved_category_color(c),
                "names_locked": _names_locked(c),
                "enabled": bool(getattr(c, "enabled", True)),
                "internal_reserved": internal_reserved,
                "has_transactions": cn > 0,
                "template_cat_id": getattr(c, "template_cat_id", None),
                "subcategories": [
                    {
                        "id": s.id,
                        "category_id": s.category_id,
                        "name": s.name,
                        "enabled": bool(getattr(s, "enabled", True)),
                        "sort_order": int(getattr(s, "sort_order", 0) or 0),
                        "has_transactions": sub_tx.get(s.id, 0) > 0,
                        "template_sub_id": getattr(s, "template_sub_id", None),
                    }
                    for s in subs
                ],
            }
        )
    return out


def first_day_of_month_calendar(d: date) -> date:
    return date(d.year, d.month, 1)


def _last_day_of_current_accounting_month_cl() -> date:
    """Último día del mes calendario en curso (zona horaria Chile)."""
    d = datetime.now(ZoneInfo("America/Santiago")).date()
    y, m = d.year, d.month
    return date(y, m, monthrange(y, m)[1])


def _banking_effective_accounting_first_day_for_fecha_expr(db: Session):
    """
    Primer día del mes contable inferido por `fecha`: en SQLite, date(fecha, 'start of month');
    en PostgreSQL, date_trunc (no usar date(…, 'start of month') — no existe en PG).
    """
    dname = db.get_bind().dialect.name
    if dname == "postgresql":
        first_of_fecha = cast(func.date_trunc("month", BankingTransaction.fecha), Date)
    else:
        first_of_fecha = func.date(BankingTransaction.fecha, "start of month")
    return first_of_fecha


def banking_filter_transactions_through_current_accounting_month(db: Session):
    """
    Incluye movimientos cuyo mes contable (efectivo) no es posterior al mes en curso en Chile.
    Excluye, por ejemplo, apuntes con mes contable adelantado al mes siguiente.
    """
    end = _last_day_of_current_accounting_month_cl()
    first_of = _banking_effective_accounting_first_day_for_fecha_expr(db)
    return func.coalesce(BankingTransaction.accounting_month, first_of) <= literal(end, type_=Date())


def _banking_today_cl() -> date:
    """Fecha calendario Chile para «hoy» al marcar pagado / liquidado."""
    return datetime.now(ZoneInfo("America/Santiago")).date()


def _banking_amount_per_person(tx: BankingTransaction) -> float | None:
    if not getattr(tx, "is_shared", False):
        return None
    n = getattr(tx, "split_participants", None)
    if n is None or int(n) < 1:
        return None
    return round(float(tx.amount) / float(n), 4)


def transaction_to_out(
    db: Session,
    tx: BankingTransaction,
    account_name: str | None = None,
    category_name: str | None = None,
    sub_name: str | None = None,
) -> dict[str, Any]:
    acc = (
        db.query(BankingAccount).filter(BankingAccount.id == tx.account_id).first()
        if account_name is None
        else None
    )
    cat = db.query(BankingCategory).filter(BankingCategory.id == tx.category_id).first() if category_name is None else None
    sub = (
        db.query(BankingSubcategory).filter(BankingSubcategory.id == tx.subcategory_id).first()
        if sub_name is None
        else None
    )
    return {
        "id": tx.id,
        "account_id": tx.account_id,
        "account_name": account_name or (acc.name if acc else ""),
        "fecha": tx.fecha,
        "amount": float(tx.amount),
        "description": tx.description,
        "category_id": tx.category_id,
        "category_name": category_name or (cat.name if cat else ""),
        "category_template_cat_id": int(cat.template_cat_id) if cat and getattr(cat, "template_cat_id", None) is not None else None,
        "category_color": resolved_category_color(cat),
        "subcategory_id": tx.subcategory_id,
        "subcategory_name": sub_name or (sub.name if sub else ""),
        "created_at": tx.created_at,
        "is_shared": bool(getattr(tx, "is_shared", False)),
        "split_participants": getattr(tx, "split_participants", None),
        "shared_expense_settled": bool(getattr(tx, "shared_expense_settled", False)),
        "credit_card_charge_paid": getattr(tx, "credit_card_charge_paid", None),
        "accounting_month": getattr(tx, "accounting_month", None),
        "amount_per_person": _banking_amount_per_person(tx),
        "peer_transaction_id": getattr(tx, "peer_transaction_id", None),
        "is_provision_reversal": _is_provision_reversal_movement(db, tx.user_id, tx),
        **_transaction_counterpart_fields(db, tx),
    }


def _transaction_counterpart_fields(db: Session, tx: BankingTransaction) -> dict[str, Any]:
    peer_id = getattr(tx, "peer_transaction_id", None)
    if not peer_id:
        return {
            "counterpart_account_id": None,
            "counterpart_account_name": None,
        }
    peer = (
        db.query(BankingTransaction)
        .filter(BankingTransaction.user_id == tx.user_id, BankingTransaction.id == int(peer_id))
        .first()
    )
    if not peer:
        return {
            "counterpart_account_id": None,
            "counterpart_account_name": None,
        }
    pa = db.query(BankingAccount).filter(BankingAccount.id == peer.account_id).first()
    return {
        "counterpart_account_id": peer.account_id,
        "counterpart_account_name": pa.name if pa else "",
    }


def _create_transferencia_entre_cuentas_propias_pair(
    db: Session,
    user_id: int,
    *,
    source_account: BankingAccount,
    category_id: int,
    subcategory_id: int,
    fecha: date,
    amount: float,
    description: str | None,
    is_shared: bool,
    split_participants: int | None,
    shared_expense_settled: bool,
    credit_card_charge_paid: bool | None,
    accounting_month: date | None,
    transfer_destination_account_id: int | None,
) -> BankingTransaction:
    if transfer_destination_account_id is None:
        raise HTTPException(
            status_code=400,
            detail="Indica el producto destino de la transferencia (no puede ser tarjeta de crédito).",
        )
    if int(transfer_destination_account_id) == int(source_account.id):
        raise HTTPException(
            status_code=400,
            detail="El producto destino no puede ser el mismo que el producto de este movimiento.",
        )
    dest_acc = get_account_for_user(db, user_id, int(transfer_destination_account_id))
    if not dest_acc:
        raise HTTPException(status_code=404, detail="Cuenta destino no encontrada")
    if not getattr(dest_acc, "enabled", True):
        raise HTTPException(
            status_code=400,
            detail="El producto destino no está disponible para movimientos (desactivado).",
        )
    if getattr(dest_acc, "product_type", None) == "tarjeta_credito":
        raise HTTPException(
            status_code=400,
            detail="La transferencia entre cuentas propias no puede destinar a una tarjeta de crédito.",
        )

    acct_month = accounting_month if accounting_month is not None else first_day_of_month_calendar(fecha)
    src_pt = getattr(source_account, "product_type", None)
    if src_pt == "tarjeta_credito":
        cc_src = bool(credit_card_charge_paid) if credit_card_charge_paid is not None else False
    else:
        cc_src = None

    sp: int | None
    settled = bool(shared_expense_settled)
    if is_shared:
        sp = int(split_participants) if split_participants is not None else 2
        if sp < 1:
            raise HTTPException(status_code=400, detail="El número de personas debe ser >= 1.")
    else:
        sp = None
        settled = False

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    amt_f = float(amount)
    mirror = -amt_f
    desc = (description or "").strip() or None

    tx_src = BankingTransaction(
        user_id=user_id,
        account_id=source_account.id,
        fecha=fecha,
        amount=amt_f,
        description=desc,
        category_id=category_id,
        subcategory_id=subcategory_id,
        created_at=now,
        is_shared=bool(is_shared),
        split_participants=sp,
        shared_expense_settled=settled,
        credit_card_charge_paid=cc_src,
        accounting_month=acct_month,
        status="posted",
    )
    tx_dst = BankingTransaction(
        user_id=user_id,
        account_id=dest_acc.id,
        fecha=fecha,
        amount=mirror,
        description=desc,
        category_id=category_id,
        subcategory_id=subcategory_id,
        created_at=now,
        is_shared=bool(is_shared),
        split_participants=sp,
        shared_expense_settled=settled,
        credit_card_charge_paid=None,
        accounting_month=acct_month,
        status="posted",
    )
    db.add(tx_src)
    db.add(tx_dst)
    db.flush()
    tx_src.peer_transaction_id = tx_dst.id
    tx_dst.peer_transaction_id = tx_src.id
    db.commit()
    db.refresh(tx_src)
    db.refresh(tx_dst)
    reconcile_banking_account_balance(db, source_account.id)
    reconcile_banking_account_balance(db, dest_acc.id)
    db.commit()
    db.refresh(tx_src)
    return tx_src


def create_transaction_row(
    db: Session,
    user_id: int,
    *,
    account_id: int,
    fecha: date,
    amount: float,
    description: str | None,
    category_id: int,
    subcategory_id: int,
    is_shared: bool = False,
    split_participants: int | None = None,
    shared_expense_settled: bool = False,
    credit_card_charge_paid: bool | None = None,
    accounting_month: date | None = None,
    transfer_destination_account_id: int | None = None,
) -> BankingTransaction:
    if amount == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser cero (usa positivo o negativo).")

    acc = get_account_for_user(db, user_id, account_id)
    if not acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    if not getattr(acc, "enabled", True):
        raise HTTPException(
            status_code=400,
            detail="Este producto no está disponible para nuevos movimientos (desactivado en configuración).",
        )

    cat = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.id == category_id)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    tpl = getattr(cat, "template_cat_id", None)
    if tpl is not None and int(tpl) in INTERNAL_BANKING_TEMPLATE_CAT_IDS:
        raise HTTPException(status_code=400, detail="Esta categoría está reservada para uso interno de la aplicación.")

    sub = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.id == subcategory_id,
            BankingSubcategory.category_id == category_id,
            BankingSubcategory.user_id == user_id,
        )
        .first()
    )
    if not sub:
        raise HTTPException(status_code=400, detail="La subcategoría no pertenece a la categoría indicada")

    if not getattr(cat, "enabled", True):
        raise HTTPException(status_code=400, detail="La categoría está desactivada.")
    if not getattr(sub, "enabled", True):
        raise HTTPException(status_code=400, detail="La subcategoría está desactivada.")

    if is_transferencia_entre_cuentas_propias(cat, sub):
        return _create_transferencia_entre_cuentas_propias_pair(
            db,
            user_id,
            source_account=acc,
            category_id=category_id,
            subcategory_id=subcategory_id,
            fecha=fecha,
            amount=float(amount),
            description=description,
            is_shared=is_shared,
            split_participants=split_participants,
            shared_expense_settled=shared_expense_settled,
            credit_card_charge_paid=credit_card_charge_paid,
            accounting_month=accounting_month,
            transfer_destination_account_id=transfer_destination_account_id,
        )

    pt = getattr(acc, "product_type", None)
    acct_month = accounting_month if accounting_month is not None else first_day_of_month_calendar(fecha)
    if pt == "tarjeta_credito":
        cc_paid = bool(credit_card_charge_paid) if credit_card_charge_paid is not None else False
    else:
        cc_paid = None

    sp: int | None
    settled = bool(shared_expense_settled)
    if is_shared:
        sp = int(split_participants) if split_participants is not None else 2
        if sp < 1:
            raise HTTPException(status_code=400, detail="El número de personas debe ser >= 1.")
    else:
        sp = None
        settled = False

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    tx = BankingTransaction(
        user_id=user_id,
        account_id=account_id,
        fecha=fecha,
        amount=float(amount),
        description=(description or "").strip() or None,
        category_id=category_id,
        subcategory_id=subcategory_id,
        created_at=now,
        is_shared=bool(is_shared),
        split_participants=sp,
        shared_expense_settled=settled,
        credit_card_charge_paid=cc_paid,
        accounting_month=acct_month,
    )
    if pt == "tarjeta_credito":
        cc_paid_flag = bool(credit_card_charge_paid) if credit_card_charge_paid is not None else False
        if cc_paid_flag:
            lid = getattr(acc, "linked_checking_account_id", None)
            if not lid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Configura la cuenta corriente asociada a esta tarjeta para marcar el cargo como pagado.",
                )
            validate_linked_checking_for_credit_card(
                db,
                user_id,
                bank_sbif=str(getattr(acc, "bank_sbif", "") or ""),
                linked_checking_account_id=int(lid),
                exclude_account_id=acc.id,
            )

    db.add(tx)
    db.commit()
    db.refresh(tx)
    reconcile_banking_account_balance(db, account_id)
    db.commit()
    db.refresh(tx)
    if pt == "tarjeta_credito":
        sync_credit_card_payment_mirror(db, user_id, tx)
        db.commit()
        db.refresh(tx)
        reconcile_banking_account_balance(db, account_id)
        lid_cc = getattr(acc, "linked_checking_account_id", None)
        if lid_cc:
            reconcile_banking_account_balance(db, int(lid_cc))
        db.commit()
    return tx


def reverse_provision_transaction_row(db: Session, user_id: int, tx_id: int) -> BankingTransaction:
    """
    Nuevo movimiento en la misma cuenta/categoría/subcategoría, monto opuesto,
    descripción «Reversa - …» + texto original. Solo categoría plantilla Provisiones (21).
    Fecha del nuevo movimiento: hoy (America/Santiago).
    """
    tx = (
        db.query(BankingTransaction)
        .filter(BankingTransaction.user_id == user_id, BankingTransaction.id == tx_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Movimiento no encontrado")

    if _is_provision_reversal_movement(db, user_id, tx):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede revertir una reversa de provisión.",
        )

    cat = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.id == tx.category_id)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Categoría no encontrada")

    tpl = getattr(cat, "template_cat_id", None)
    if tpl is None or int(tpl) != TEMPLATE_CAT_PROVISIONES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se puede revertir movimientos de categoría Provisiones.",
        )

    sub = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.id == tx.subcategory_id,
            BankingSubcategory.category_id == tx.category_id,
            BankingSubcategory.user_id == user_id,
        )
        .first()
    )
    if not sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La subcategoría no coincide con la categoría.")
    if not getattr(cat, "enabled", True):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La categoría está desactivada.")
    if not getattr(sub, "enabled", True):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La subcategoría está desactivada.")

    acc = get_account_for_user(db, user_id, tx.account_id)
    if not acc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cuenta no encontrada")
    if not getattr(acc, "enabled", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este producto no está disponible para nuevos movimientos (desactivado en configuración).",
        )

    amt_rev = -float(tx.amount)
    if amt_rev == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El monto del movimiento original es cero.")

    orig_desc = (tx.description or "").strip()
    new_desc = ("Reversa - " + orig_desc) if orig_desc else "Reversa -"

    fecha_rev = _banking_today_cl()
    acct_month = first_day_of_month_calendar(fecha_rev)

    is_shared = bool(getattr(tx, "is_shared", False))
    sp_raw = getattr(tx, "split_participants", None)
    settled = bool(getattr(tx, "shared_expense_settled", False))
    if is_shared:
        sp = int(sp_raw) if sp_raw is not None else 2
        if sp < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="split_participants inválido en el original.")
    else:
        sp = None
        settled = False

    pt = getattr(acc, "product_type", None)
    cc_paid = getattr(tx, "credit_card_charge_paid", None) if pt == "tarjeta_credito" else None

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    new_tx = BankingTransaction(
        user_id=user_id,
        account_id=tx.account_id,
        fecha=fecha_rev,
        amount=amt_rev,
        description=new_desc,
        category_id=tx.category_id,
        subcategory_id=tx.subcategory_id,
        created_at=now,
        is_shared=is_shared,
        split_participants=sp,
        shared_expense_settled=settled if is_shared else False,
        credit_card_charge_paid=cc_paid,
        accounting_month=acct_month,
        status="posted",
        peer_transaction_id=None,
    )
    db.add(new_tx)
    db.commit()
    db.refresh(new_tx)
    reconcile_banking_account_balance(db, tx.account_id)
    db.commit()
    db.refresh(new_tx)
    if pt == "tarjeta_credito":
        sync_credit_card_payment_mirror(db, user_id, new_tx)
        db.commit()
        db.refresh(new_tx)
        reconcile_banking_account_balance(db, tx.account_id)
        lid_cc = getattr(acc, "linked_checking_account_id", None)
        if lid_cc:
            reconcile_banking_account_balance(db, int(lid_cc))
        db.commit()
    return new_tx


def patch_transaction_row(
    db: Session,
    user_id: int,
    tx_id: int,
    *,
    account_id: int | None,
    fecha: date | None,
    amount: float | None,
    description: str | None,
    category_id: int | None,
    subcategory_id: int | None,
    is_shared: bool | None = None,
    split_participants: int | None = None,
    shared_expense_settled: bool | None = None,
    credit_card_charge_paid: bool | None = None,
    accounting_month: date | None = None,
) -> BankingTransaction:
    tx = (
        db.query(BankingTransaction)
        .filter(BankingTransaction.user_id == user_id, BankingTransaction.id == tx_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    old_shared_settled = bool(getattr(tx, "shared_expense_settled", False))
    old_cc_paid = getattr(tx, "credit_card_charge_paid", None)

    if getattr(tx, "peer_transaction_id", None):
        raise HTTPException(
            status_code=400,
            detail="Este movimiento está vinculado a una transferencia entre cuentas propias. Elimínalo si necesitas cambiar cuenta, monto o fecha.",
        )

    if _is_provision_reversal_movement(db, user_id, tx):
        raise HTTPException(
            status_code=400,
            detail="Las reversas de provisión no se pueden editar. Elimina el movimiento si necesitas anularla.",
        )

    old_acc = get_account_for_user(db, user_id, tx.account_id)
    if not old_acc:
        raise HTTPException(status_code=400, detail="Cuenta origen inválida")

    new_account_id = account_id if account_id is not None else tx.account_id
    new_fecha = fecha if fecha is not None else tx.fecha
    new_amount = float(amount) if amount is not None else float(tx.amount)
    new_desc = tx.description if description is None else ((description or "").strip() or None)
    new_cat = category_id if category_id is not None else tx.category_id
    new_sub = subcategory_id if subcategory_id is not None else tx.subcategory_id

    if new_amount == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser cero.")

    new_acc = get_account_for_user(db, user_id, new_account_id)
    if not new_acc:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    if new_account_id != tx.account_id and not getattr(new_acc, "enabled", True):
        raise HTTPException(
            status_code=400,
            detail="Este producto no está disponible para movimientos (desactivado en configuración).",
        )

    cat = (
        db.query(BankingCategory)
        .filter(BankingCategory.user_id == user_id, BankingCategory.id == new_cat)
        .first()
    )
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")

    tpl = getattr(cat, "template_cat_id", None)
    if tpl is not None and int(tpl) in INTERNAL_BANKING_TEMPLATE_CAT_IDS and new_cat != tx.category_id:
        raise HTTPException(status_code=400, detail="Esta categoría está reservada para uso interno de la aplicación.")

    sub = (
        db.query(BankingSubcategory)
        .filter(
            BankingSubcategory.id == new_sub,
            BankingSubcategory.category_id == new_cat,
            BankingSubcategory.user_id == user_id,
        )
        .first()
    )
    if not sub:
        raise HTTPException(status_code=400, detail="La subcategoría no pertenece a la categoría indicada")

    if not getattr(cat, "enabled", True):
        raise HTTPException(status_code=400, detail="La categoría está desactivada.")
    if not getattr(sub, "enabled", True):
        raise HTTPException(status_code=400, detail="La subcategoría está desactivada.")

    prev_account_id = tx.account_id

    tx.account_id = new_account_id
    tx.fecha = new_fecha
    tx.amount = new_amount
    tx.description = new_desc
    tx.category_id = new_cat
    tx.subcategory_id = new_sub

    next_shared = bool(tx.is_shared) if is_shared is None else bool(is_shared)
    if is_shared is not None:
        tx.is_shared = next_shared
    if shared_expense_settled is not None:
        tx.shared_expense_settled = bool(shared_expense_settled)
    if split_participants is not None:
        if split_participants < 1:
            raise HTTPException(status_code=400, detail="El número de personas debe ser >= 1.")
        tx.split_participants = split_participants
    if is_shared is not None and not next_shared:
        tx.split_participants = None
        tx.shared_expense_settled = False
    elif next_shared and tx.split_participants is None:
        tx.split_participants = 2

    acc_final = get_account_for_user(db, user_id, tx.account_id)
    if acc_final is None:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    pt_final = getattr(acc_final, "product_type", None)
    if credit_card_charge_paid is not None:
        tx.credit_card_charge_paid = bool(credit_card_charge_paid) if pt_final == "tarjeta_credito" else None
    elif pt_final != "tarjeta_credito":
        tx.credit_card_charge_paid = None
    elif tx.credit_card_charge_paid is None and pt_final == "tarjeta_credito":
        tx.credit_card_charge_paid = False

    if accounting_month is not None:
        tx.accounting_month = accounting_month
    elif fecha is not None:
        tx.accounting_month = first_day_of_month_calendar(new_fecha)
    elif getattr(tx, "accounting_month", None) is None:
        tx.accounting_month = first_day_of_month_calendar(tx.fecha)

    # Sin fecha explícita en el PATCH: al liquidar compartido o marcar cargo TC pagado, usar el día actual (CL).
    if fecha is None:
        d_pay = _banking_today_cl()
        am_pay = first_day_of_month_calendar(d_pay)
        if (
            shared_expense_settled is not None
            and bool(tx.shared_expense_settled)
            and not old_shared_settled
            and bool(getattr(tx, "is_shared", False))
        ):
            tx.fecha = d_pay
            tx.accounting_month = am_pay
        elif (
            credit_card_charge_paid is not None
            and pt_final == "tarjeta_credito"
            and bool(tx.credit_card_charge_paid)
            and (old_cc_paid is None or old_cc_paid is False)
        ):
            tx.fecha = d_pay
            tx.accounting_month = am_pay

    old_pt = getattr(old_acc, "product_type", None)
    if pt_final == "tarjeta_credito" or old_pt == "tarjeta_credito":
        sync_credit_card_payment_mirror(db, user_id, tx)

    db.commit()
    db.refresh(tx)
    for aid in {prev_account_id, tx.account_id}:
        reconcile_banking_account_balance(db, aid)
    db.commit()
    db.refresh(tx)
    if pt_final == "tarjeta_credito" or old_pt == "tarjeta_credito":
        for lid in (
            getattr(acc_final, "linked_checking_account_id", None),
            getattr(old_acc, "linked_checking_account_id", None),
        ):
            if lid:
                reconcile_banking_account_balance(db, int(lid))
        db.commit()
        db.refresh(tx)
    return tx


def delete_transaction_row(db: Session, user_id: int, tx_id: int) -> None:
    tx = (
        db.query(BankingTransaction)
        .filter(BankingTransaction.user_id == user_id, BankingTransaction.id == tx_id)
        .first()
    )
    if not tx:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    acc_ids: set[int] = {tx.account_id}

    # Egreso «Pago Tarjeta de Credito» en cuenta corriente (peer → cargo TC): no borrar el cargo.
    peer_ref = getattr(tx, "peer_transaction_id", None)
    if peer_ref:
        cc_charge = (
            db.query(BankingTransaction)
            .filter(BankingTransaction.user_id == user_id, BankingTransaction.id == int(peer_ref))
            .first()
        )
        cat_del = get_category_for_user(db, user_id, tx.category_id)
        tpl_del = getattr(cat_del, "template_cat_id", None) if cat_del else None
        if (
            cc_charge
            and tpl_del is not None
            and int(tpl_del) == TEMPLATE_CAT_PAGO_TARJETA_CREDITO
        ):
            cc_acc = get_account_for_user(db, user_id, cc_charge.account_id)
            if cc_acc and getattr(cc_acc, "product_type", None) == "tarjeta_credito":
                cc_charge.credit_card_charge_paid = False
                aid_pay = int(tx.account_id)
                aid_cc = int(cc_charge.account_id)
                tx.peer_transaction_id = None
                db.delete(tx)
                db.commit()
                reconcile_banking_account_balance(db, aid_pay)
                reconcile_banking_account_balance(db, aid_cc)
                db.commit()
                return

    # Borrar cargo en tarjeta: eliminar primero pagos automáticos que referencian este movimiento.
    for pay in (
        db.query(BankingTransaction)
        .filter(
            BankingTransaction.user_id == user_id,
            BankingTransaction.peer_transaction_id == tx.id,
        )
        .all()
    ):
        acc_ids.add(int(pay.account_id))
        pay.peer_transaction_id = None
        db.delete(pay)

    peer_id = getattr(tx, "peer_transaction_id", None)
    peer_tx = None
    if peer_id:
        peer_tx = (
            db.query(BankingTransaction)
            .filter(BankingTransaction.user_id == user_id, BankingTransaction.id == int(peer_id))
            .first()
        )
        if peer_tx:
            acc_ids.add(int(peer_tx.account_id))
            peer_tx.peer_transaction_id = None
            db.delete(peer_tx)
    tx.peer_transaction_id = None
    db.delete(tx)
    db.commit()
    for aid in acc_ids:
        reconcile_banking_account_balance(db, aid)
    db.commit()


def create_category_row(
    db: Session, user_id: int, *, name: str, sort_order: int, color: str | None = None
) -> BankingCategory:
    """Categoría creada por el usuario: color por defecto coral (`_BANK_CAT_DEFAULT`)."""
    c_hex = _normalize_hex_color(color) or _BANK_CAT_DEFAULT
    bc = BankingCategory(
        user_id=user_id,
        name=name.strip(),
        sort_order=sort_order,
        color=c_hex,
        names_locked=False,
        enabled=True,
    )
    db.add(bc)
    db.commit()
    db.refresh(bc)
    return bc


def patch_category_row(
    db: Session,
    user_id: int,
    category_id: int,
    *,
    name: str | None,
    sort_order: int | None,
    color: str | None,
    enabled: bool | None,
) -> BankingCategory:
    c = get_category_for_user(db, user_id, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    if _category_is_internal_reserved(c):
        if name is not None or sort_order is not None or enabled is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta categoría está reservada: solo puedes cambiar el color.",
            )
        if color is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nada que actualizar")
        n = _normalize_hex_color(color)
        c.color = n if n else category_color_for_index(c.sort_order)
        db.commit()
        db.refresh(c)
        return c
    locked = _names_locked(c)
    if locked:
        if name is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="El nombre de la categoría está fijado por la plantilla.",
            )
        if sort_order is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Para cambiar el orden usa el endpoint de reordenar categorías.",
            )
    if name is not None:
        c.name = name.strip()
    if sort_order is not None:
        c.sort_order = sort_order
    if color is not None:
        n = _normalize_hex_color(color)
        c.color = n if n else category_color_for_index(c.sort_order)
    if enabled is not None:
        if not enabled:
            n_cat = (
                db.query(func.count(BankingTransaction.id))
                .filter(
                    BankingTransaction.user_id == user_id,
                    BankingTransaction.category_id == category_id,
                )
                .scalar()
                or 0
            )
            if n_cat > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No puedes desactivar la categoría: hay movimientos que la usan.",
                )
        c.enabled = enabled
    db.commit()
    db.refresh(c)
    return c


def delete_category_row(db: Session, user_id: int, category_id: int) -> None:
    c = get_category_for_user(db, user_id, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    if _names_locked(c):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede eliminar una categoría fijada por la plantilla.",
        )
    sub_ids = [s.id for s in db.query(BankingSubcategory).filter(BankingSubcategory.category_id == category_id).all()]
    if not sub_ids:
        db.delete(c)
        db.commit()
        return
    n_tx = (
        db.query(func.count(BankingTransaction.id))
        .filter(BankingTransaction.subcategory_id.in_(sub_ids))
        .scalar()
        or 0
    )
    if n_tx > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar: hay movimientos que usan subcategorías de esta categoría.",
        )
    db.query(BankingSubcategory).filter(BankingSubcategory.category_id == category_id).delete()
    db.delete(c)
    db.commit()


def create_subcategory_row(db: Session, user_id: int, *, category_id: int, name: str) -> BankingSubcategory:
    c = get_category_for_user(db, user_id, category_id)
    if not c:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    if _category_is_internal_reserved(c):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pueden añadir subcategorías a categorías reservadas para la aplicación.",
        )
    max_so = (
        db.query(func.coalesce(func.max(BankingSubcategory.sort_order), -1))
        .filter(BankingSubcategory.category_id == category_id)
        .scalar()
    )
    next_so = int(max_so) + 1
    s = BankingSubcategory(
        user_id=user_id,
        category_id=category_id,
        name=name.strip(),
        template_sub_id=None,
        sort_order=next_so,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def patch_subcategory_row(
    db: Session,
    user_id: int,
    subcategory_id: int,
    *,
    name: str | None,
    category_id: int | None,
    enabled: bool | None,
) -> BankingSubcategory:
    sub = get_subcategory_for_user(db, user_id, subcategory_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subcategoría no encontrada")
    parent_old = get_category_for_user(db, user_id, sub.category_id)
    if parent_old is not None and _category_is_internal_reserved(parent_old):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Esta subcategoría pertenece a una categoría reservada para la aplicación.",
        )
    locked = parent_old is not None and _names_locked(parent_old)

    if locked:
        user_custom = getattr(sub, "template_sub_id", None) is None
        if category_id is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No se puede cambiar la categoría de una subcategoría bajo plantilla fijada.",
            )
        if name is not None and not user_custom:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Los nombres de subcategorías vienen de la plantilla.",
            )
        if name is not None and user_custom:
            nm = name.strip()
            if not nm:
                raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
            sub.name = nm
        if enabled is not None:
            if not enabled:
                n_tx = (
                    db.query(func.count(BankingTransaction.id))
                    .filter(
                        BankingTransaction.user_id == user_id,
                        BankingTransaction.subcategory_id == subcategory_id,
                    )
                    .scalar()
                    or 0
                )
                if n_tx > 0:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="No puedes desactivar esta subcategoría: hay movimientos que la usan.",
                    )
            sub.enabled = enabled
        if name is None and enabled is None:
            raise HTTPException(status_code=400, detail="Nada que actualizar")
        db.commit()
        db.refresh(sub)
        return sub

    new_cat = category_id if category_id is not None else sub.category_id
    if category_id is not None:
        c = get_category_for_user(db, user_id, new_cat)
        if not c:
            raise HTTPException(status_code=404, detail="Categoría no encontrada")
        if _category_is_internal_reserved(c):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No se puede asignar a una categoría reservada para la aplicación.",
            )
        sub.category_id = new_cat
    if name is not None:
        sub.name = name.strip()
    if enabled is not None:
        if not enabled:
            n_tx = (
                db.query(func.count(BankingTransaction.id))
                .filter(
                    BankingTransaction.user_id == user_id,
                    BankingTransaction.subcategory_id == subcategory_id,
                )
                .scalar()
                or 0
            )
            if n_tx > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="No puedes desactivar esta subcategoría: hay movimientos que la usan.",
                )
        sub.enabled = enabled
    db.commit()
    db.refresh(sub)
    return sub


def delete_subcategory_row(db: Session, user_id: int, subcategory_id: int) -> None:
    sub = get_subcategory_for_user(db, user_id, subcategory_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subcategoría no encontrada")
    parent = get_category_for_user(db, user_id, sub.category_id)
    if parent and _names_locked(parent) and getattr(sub, "template_sub_id", None) is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No se puede eliminar una subcategoría fijada por la plantilla.",
        )
    n_tx = (
        db.query(func.count(BankingTransaction.id))
        .filter(BankingTransaction.subcategory_id == subcategory_id)
        .scalar()
        or 0
    )
    if n_tx > 0:
        raise HTTPException(
            status_code=400,
            detail="No se puede eliminar: hay movimientos con esta subcategoría.",
        )
    db.delete(sub)
    db.commit()
