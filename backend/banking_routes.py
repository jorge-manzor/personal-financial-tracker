from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from auth import BankingUser
from banking_service import (
    create_category_row,
    create_subcategory_row,
    BANKING_PRODUCT_TYPES,
    banking_account_to_out,
    banking_apply_credit_card_transaction_scope,
    banking_apply_provision_transaction_scope,
    banking_apply_shared_transaction_scope,
    banking_bulk_reverse_provision,
    banking_bulk_set_shared_expense_settled,
    banking_credit_card_unpaid_groups_payload,
    banking_provisions_pending_reversal_groups_payload,
    banking_shared_unsettled_groups_payload,
    banking_debt_totals_out,
    banking_provision_sum_by_account,
    banking_sum_amounts_by_account,
    banking_transaction_counts_by_account,
    count_credit_cards_linked_to_checking,
    create_transaction_row,
    delete_category_row,
    delete_subcategory_row,
    delete_transaction_row,
    ensure_default_categories,
    get_account_for_user,
    is_valid_bank_sbif,
    list_categories_nested,
    load_bancos_chile,
    reorder_categories_for_user,
    reorder_subcategories_for_user,
    patch_category_row,
    patch_subcategory_row,
    patch_transaction_row,
    repair_phantom_negative_balances_for_user,
    reverse_provision_transaction_row,
    transaction_to_out,
    validate_linked_checking_for_credit_card,
)
from database import get_db
from models import BankingAccount, BankingCategory, BankingTransaction
from schemas import (
    BankingAccountCreate,
    BankingAccountOut,
    BankingAccountPatch,
    BankingBankOut,
    BankingBulkReverseProvisionBody,
    BankingBulkReverseProvisionOut,
    BankingBulkSharedSettledBody,
    BankingBulkSharedSettledOut,
    BankingCreditCardUnpaidGroupedResponse,
    BankingSharedUnsettledGroupedResponse,
    BankingCreditCardUnpaidGroupOut,
    BankingDebtTotalsOut,
    BankingCategoriesReorderBody,
    BankingSubcategoriesReorderBody,
    BankingCategoryCreate,
    BankingCategoryOut,
    BankingCategoryPatch,
    BankingSubcategoryCreate,
    BankingSubcategoryOut,
    BankingSubcategoryPatch,
    BankingTransactionCreate,
    BankingTransactionListOut,
    BankingTransactionOut,
    BankingTransactionPatch,
)

"""Días hacia atrás desde hoy cuando no hay rango explícito ni historial completo."""
BANKING_TX_DEFAULT_LOOKBACK_DAYS = 60

BANKING_BALANCE_SCOPES = frozenset({"ledger", "through_current_accounting_month"})


def _parse_balance_scope(balance_scope: str | None) -> str:
    v = (balance_scope or "ledger").strip()
    if v in BANKING_BALANCE_SCOPES:
        return v
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="balance_scope debe ser ledger o through_current_accounting_month",
    )


def _first_day_next_month(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)


def _parse_month_yyyy_mm(s: str) -> date:
    try:
        s = (s or "").strip()
        parts = s.split("-")
        if len(parts) < 2:
            raise ValueError
        y, m = int(parts[0]), int(parts[1])
        if not (1 <= m <= 12):
            raise ValueError
        return date(y, m, 1)
    except (ValueError, IndexError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mes contable: use formato YYYY-MM.") from e


def _accounting_month_span_expr(start: date, end_inc: date):
    """Unión de filas con accounting_month en el rango y, si es null, fecha dentro del mismo span calendario."""
    if start > end_inc:
        start, end_inc = end_inc, start
    end_excl = _first_day_next_month(end_inc)
    acct_ok = and_(
        BankingTransaction.accounting_month.isnot(None),
        BankingTransaction.accounting_month >= start,
        BankingTransaction.accounting_month <= end_inc,
    )
    fecha_fallback = and_(
        BankingTransaction.accounting_month.is_(None),
        BankingTransaction.fecha >= start,
        BankingTransaction.fecha < end_excl,
    )
    return or_(acct_ok, fecha_fallback)


def _parse_iso_date_yyyy_mm_dd(s: str) -> date:
    try:
        s = (s or "").strip()
        parts = s.split("-")
        if len(parts) < 3:
            raise ValueError
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        return date(y, m, d)
    except (ValueError, IndexError) as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date_from / date_to: use formato YYYY-MM-DD.",
        ) from e


def _banking_transactions_scope_expr(
    *,
    full_history: bool,
    accounting_month_from: str | None,
    accounting_month_to: str | None,
    date_from: str | None,
    date_to: str | None,
):
    """Predeterminado: últimos N días por `fecha` del movimiento. Tiene prioridad mes contable explícito, luego rango fecha."""
    if full_history:
        return None
    if accounting_month_from and accounting_month_to:
        start = _parse_month_yyyy_mm(accounting_month_from)
        end_inc = _parse_month_yyyy_mm(accounting_month_to)
        return _accounting_month_span_expr(start, end_inc)
    if accounting_month_from or accounting_month_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Envíe accounting_month_from y accounting_month_to juntos.",
        )
    if date_from and date_to:
        df = _parse_iso_date_yyyy_mm_dd(date_from)
        dt = _parse_iso_date_yyyy_mm_dd(date_to)
        if df > dt:
            df, dt = dt, df
        return and_(BankingTransaction.fecha >= df, BankingTransaction.fecha <= dt)
    if date_from or date_to:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Envíe date_from y date_to juntos (YYYY-MM-DD).",
        )
    today = date.today()
    cutoff = today - timedelta(days=BANKING_TX_DEFAULT_LOOKBACK_DAYS)
    return and_(BankingTransaction.fecha >= cutoff, BankingTransaction.fecha <= today)


def _banking_transactions_column_filter_exprs(
    *,
    description: str | None,
    amount_min: float | None,
    amount_max: float | None,
    tx_date_from: str | None,
    tx_date_to: str | None,
    category_ids: list[int] | None,
    subcategory_ids: list[int] | None,
    shared_scopes: list[str] | None,
    liquidado_values: list[str] | None,
    tc_paid_values: list[str] | None,
    accounting_months: list[str] | None,
):
    exprs = []
    desc = (description or "").strip().lower()
    if desc:
        exprs.append(func.lower(func.coalesce(BankingTransaction.description, "")).like(f"%{desc}%"))
    if amount_min is not None:
        exprs.append(BankingTransaction.amount >= amount_min)
    if amount_max is not None:
        exprs.append(BankingTransaction.amount <= amount_max)
    if tx_date_from:
        exprs.append(BankingTransaction.fecha >= _parse_iso_date_yyyy_mm_dd(tx_date_from))
    if tx_date_to:
        exprs.append(BankingTransaction.fecha <= _parse_iso_date_yyyy_mm_dd(tx_date_to))
    if category_ids:
        exprs.append(BankingTransaction.category_id.in_(list(dict.fromkeys(category_ids))))
    if subcategory_ids:
        exprs.append(BankingTransaction.subcategory_id.in_(list(dict.fromkeys(subcategory_ids))))

    shared = set(shared_scopes or [])
    unknown_shared = shared - {"personal", "shared_any"}
    if unknown_shared:
        raise HTTPException(status_code=400, detail="shared_scopes inválido.")
    if shared and shared != {"personal", "shared_any"}:
        exprs.append(BankingTransaction.is_shared.is_(True) if "shared_any" in shared else BankingTransaction.is_shared.is_(False))

    liq = set(liquidado_values or [])
    unknown_liq = liq - {"yes", "no", "na"}
    if unknown_liq:
        raise HTTPException(status_code=400, detail="liquidado_values inválido.")
    liq_exprs = []
    if "yes" in liq:
        liq_exprs.append(and_(BankingTransaction.is_shared.is_(True), BankingTransaction.shared_expense_settled.is_(True)))
    if "no" in liq:
        liq_exprs.append(and_(BankingTransaction.is_shared.is_(True), BankingTransaction.shared_expense_settled.is_(False)))
    if "na" in liq:
        liq_exprs.append(BankingTransaction.is_shared.is_(False))
    if liq_exprs:
        exprs.append(or_(*liq_exprs))

    tc = set(tc_paid_values or [])
    unknown_tc = tc - {"paid", "unpaid", "na"}
    if unknown_tc:
        raise HTTPException(status_code=400, detail="tc_paid_values inválido.")
    tc_exprs = []
    if "paid" in tc:
        tc_exprs.append(BankingTransaction.credit_card_charge_paid.is_(True))
    if "unpaid" in tc:
        tc_exprs.append(BankingTransaction.credit_card_charge_paid.is_(False))
    if "na" in tc:
        tc_exprs.append(BankingTransaction.credit_card_charge_paid.is_(None))
    if tc_exprs:
        exprs.append(or_(*tc_exprs))

    month_exprs = []
    for raw in accounting_months or []:
        start = _parse_month_yyyy_mm(raw)
        month_exprs.append(_accounting_month_span_expr(start, start))
    if month_exprs:
        exprs.append(or_(*month_exprs))
    return exprs


router = APIRouter()


@router.get("/banks", response_model=list[BankingBankOut])
def banking_list_banks(_user: BankingUser) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in load_bancos_chile():
        sb = str(row.get("sbif", "")).strip()
        name = str(row.get("name", "")).strip()
        if sb and name:
            out.append({"sbif": sb, "name": name})
    return out


@router.get("/accounts", response_model=list[BankingAccountOut])
def banking_list_accounts(
    user: BankingUser,
    db: Session = Depends(get_db),
    balance_scope: str = Query(
        "ledger",
        description="ledger=saldo libro; through_current_accounting_month=solo movimientos cuyo mes contable (efectivo) no supera el mes en curso (Chile).",
    ),
) -> list[dict[str, object]]:
    v = _parse_balance_scope(balance_scope)
    through = v == "through_current_accounting_month"
    repair_phantom_negative_balances_for_user(db, user.id)
    rows = (
        db.query(BankingAccount)
        .filter(BankingAccount.user_id == user.id)
        .order_by(BankingAccount.id)
        .all()
    )
    tx_counts = banking_transaction_counts_by_account(db, user.id) if rows else {}
    if not through:
        prov_sums = banking_provision_sum_by_account(db, user.id) if rows else {}
        return [
            banking_account_to_out(db, user.id, a, tx_counts=tx_counts, provision_sums=prov_sums) for a in rows
        ]
    sums = banking_sum_amounts_by_account(db, user.id, through_current_accounting_month=True) if rows else {}
    prov_sums = (
        banking_provision_sum_by_account(db, user.id, through_current_accounting_month=True) if rows else {}
    )
    return [
        banking_account_to_out(
            db,
            user.id,
            a,
            tx_counts=tx_counts,
            provision_sums=prov_sums,
            book_balance=float(a.opening_balance) + float(sums.get(int(a.id), 0.0)),
        )
        for a in rows
    ]


@router.get("/debt-totals", response_model=BankingDebtTotalsOut)
def banking_debt_totals(
    user: BankingUser,
    db: Session = Depends(get_db),
    balance_scope: str = Query("ledger", description="Mismo criterio que en GET /banking/accounts (TC pendiente en total deuda)."),
) -> dict[str, float]:
    v = _parse_balance_scope(balance_scope)
    return banking_debt_totals_out(
        db, user.id, through_current_accounting_month=(v == "through_current_accounting_month")
    )


@router.post("/accounts", response_model=BankingAccountOut)
def banking_create_account(
    body: BankingAccountCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if body.product_type not in BANKING_PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de producto no reconocido.")
    bsb = body.bank_sbif.strip()
    if not is_valid_bank_sbif(bsb):
        raise HTTPException(status_code=400, detail="Banco no reconocido (código SBIF).")
    if body.product_type == "tarjeta_credito" and body.linked_checking_account_id is not None:
        validate_linked_checking_for_credit_card(
            db,
            user.id,
            bank_sbif=bsb,
            linked_checking_account_id=body.linked_checking_account_id,
        )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    bal = float(body.initial_balance)
    a = BankingAccount(
        user_id=user.id,
        name=body.name.strip(),
        currency="CLP",
        enabled=bool(body.enabled),
        product_type=body.product_type,
        bank_sbif=bsb,
        linked_checking_account_id=body.linked_checking_account_id
        if body.product_type == "tarjeta_credito"
        else None,
        opening_balance=bal,
        balance=bal,
        include_in_total_balance=bool(body.include_in_total_balance),
        created_at=now,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    tx_counts = banking_transaction_counts_by_account(db, user.id)
    prov_sums = banking_provision_sum_by_account(db, user.id)
    return banking_account_to_out(db, user.id, a, tx_counts=tx_counts, provision_sums=prov_sums)


@router.patch("/accounts/{account_id}", response_model=BankingAccountOut)
def banking_patch_account(
    account_id: int,
    body: BankingAccountPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if (
        body.name is None
        and body.currency is None
        and body.balance is None
        and body.product_type is None
        and body.bank_sbif is None
        and body.linked_checking_account_id is None
        and body.enabled is None
        and body.include_in_total_balance is None
    ):
        raise HTTPException(status_code=400, detail="Nada que actualizar")

    a = get_account_for_user(db, user.id, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    cur_type = getattr(a, "product_type", None)
    cur_bank = getattr(a, "bank_sbif", None)
    cur_linked = getattr(a, "linked_checking_account_id", None)

    next_type = body.product_type if body.product_type is not None else cur_type
    next_bank = body.bank_sbif.strip() if body.bank_sbif is not None else cur_bank
    if isinstance(next_bank, str):
        next_bank = next_bank.strip()

    next_linked = body.linked_checking_account_id if body.linked_checking_account_id is not None else cur_linked
    if next_type != "tarjeta_credito":
        next_linked = None

    if next_type is not None and next_type not in BANKING_PRODUCT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de producto no reconocido.")

    if next_bank is not None and str(next_bank).strip() != "" and not is_valid_bank_sbif(str(next_bank).strip()):
        raise HTTPException(status_code=400, detail="Banco no reconocido (código SBIF).")

    if cur_type == "cuenta_corriente" and next_type != "cuenta_corriente":
        if count_credit_cards_linked_to_checking(db, user.id, account_id) > 0:
            raise HTTPException(
                status_code=400,
                detail="Hay tarjetas asociadas a esta cuenta corriente; cambia primero la asociación en cada tarjeta.",
            )

    if next_type == "tarjeta_credito":
        nb = str(next_bank or "").strip()
        if not nb:
            raise HTTPException(status_code=400, detail="Indica el banco de la tarjeta.")
        lid = next_linked
        if lid is None:
            raise HTTPException(status_code=400, detail="Selecciona la cuenta corriente asociada a esta tarjeta.")
        validate_linked_checking_for_credit_card(
            db,
            user.id,
            bank_sbif=nb,
            linked_checking_account_id=lid,
            exclude_account_id=account_id,
        )

    if body.name is not None:
        a.name = body.name.strip()
    if body.currency is not None:
        a.currency = body.currency.strip().upper()
    if body.balance is not None:
        total = (
            db.query(func.coalesce(func.sum(BankingTransaction.amount), 0.0))
            .filter(BankingTransaction.account_id == account_id)
            .scalar()
            or 0.0
        )
        a.opening_balance = float(body.balance) - float(total)
        a.balance = float(body.balance)
    if body.product_type is not None:
        a.product_type = body.product_type
    if body.bank_sbif is not None:
        a.bank_sbif = str(body.bank_sbif).strip()
    if next_type == "tarjeta_credito":
        a.linked_checking_account_id = next_linked
    else:
        a.linked_checking_account_id = None
    if body.enabled is not None:
        a.enabled = bool(body.enabled)
    if body.include_in_total_balance is not None:
        a.include_in_total_balance = bool(body.include_in_total_balance)

    db.commit()
    db.refresh(a)
    tx_counts = banking_transaction_counts_by_account(db, user.id)
    prov_sums = banking_provision_sum_by_account(db, user.id)
    return banking_account_to_out(db, user.id, a, tx_counts=tx_counts, provision_sums=prov_sums)


@router.delete("/accounts/{account_id}")
def banking_delete_account(
    account_id: int,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    a = get_account_for_user(db, user.id, account_id)
    if not a:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    n = db.query(func.count(BankingTransaction.id)).filter(BankingTransaction.account_id == account_id).scalar() or 0
    if n > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede eliminar una cuenta con movimientos. Borra o traslada los movimientos antes.",
        )
    if count_credit_cards_linked_to_checking(db, user.id, account_id) > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se puede eliminar: hay tarjetas de crédito asociadas a esta cuenta corriente.",
        )
    db.delete(a)
    db.commit()
    return {"status": "ok"}


@router.get("/categories")
def banking_categories(user: BankingUser, db: Session = Depends(get_db)) -> list[dict]:
    ensure_default_categories(db, user.id)
    return list_categories_nested(db, user.id)


@router.post("/categories", response_model=BankingCategoryOut)
def banking_create_category(
    body: BankingCategoryCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingCategoryOut:
    ensure_default_categories(db, user.id)
    max_so = (
        db.query(func.coalesce(func.max(BankingCategory.sort_order), -1))
        .filter(BankingCategory.user_id == user.id)
        .scalar()
    )
    next_so = int(max_so) + 1
    bc = create_category_row(
        db,
        user.id,
        name=body.name,
        sort_order=next_so,
        color=body.color,
    )
    nested = list_categories_nested(db, user.id)
    row = next((x for x in nested if x["id"] == bc.id), None)
    if row is None:
        raise HTTPException(status_code=500, detail="No se pudo cargar la categoría creada")
    return BankingCategoryOut(
        id=row["id"],
        name=row["name"],
        sort_order=row["sort_order"],
        color=row["color"],
        names_locked=row["names_locked"],
        enabled=row["enabled"],
        internal_reserved=row["internal_reserved"],
        has_transactions=row["has_transactions"],
        subcategories=[BankingSubcategoryOut(**s) for s in row["subcategories"]],
    )


@router.post("/categories/{category_id}/subcategories", response_model=BankingSubcategoryOut)
def banking_create_subcategory(
    category_id: int,
    body: BankingSubcategoryCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingSubcategoryOut:
    ensure_default_categories(db, user.id)
    sub = create_subcategory_row(db, user.id, category_id=category_id, name=body.name)
    nested = list_categories_nested(db, user.id)
    for cat in nested:
        if cat["id"] != category_id:
            continue
        for s in cat["subcategories"]:
            if s["id"] == sub.id:
                return BankingSubcategoryOut(**s)
    raise HTTPException(status_code=404, detail="Subcategoría no encontrada tras crear")


@router.patch("/categories/reorder")
def banking_reorder_categories(
    body: BankingCategoriesReorderBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    ensure_default_categories(db, user.id)
    reorder_categories_for_user(db, user.id, body.category_ids)
    return {"status": "ok"}


@router.patch("/categories/{category_id}/subcategories/reorder")
def banking_reorder_subcategories(
    category_id: int,
    body: BankingSubcategoriesReorderBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    ensure_default_categories(db, user.id)
    reorder_subcategories_for_user(db, user.id, category_id, body.subcategory_ids)
    return {"status": "ok"}


@router.patch("/categories/{category_id}", response_model=BankingCategoryOut)
def banking_patch_category(
    category_id: int,
    body: BankingCategoryPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingCategoryOut:
    ensure_default_categories(db, user.id)
    if (
        body.name is None
        and body.sort_order is None
        and body.color is None
        and body.enabled is None
    ):
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    patch_category_row(
        db,
        user.id,
        category_id,
        name=body.name,
        sort_order=body.sort_order,
        color=body.color,
        enabled=body.enabled,
    )
    nested = list_categories_nested(db, user.id)
    row = next((x for x in nested if x["id"] == category_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    return BankingCategoryOut(
        id=row["id"],
        name=row["name"],
        sort_order=row["sort_order"],
        color=row["color"],
        names_locked=row["names_locked"],
        enabled=row["enabled"],
        internal_reserved=row["internal_reserved"],
        has_transactions=row["has_transactions"],
        subcategories=[BankingSubcategoryOut(**s) for s in row["subcategories"]],
    )


@router.delete("/categories/{category_id}")
def banking_delete_category(category_id: int, user: BankingUser, db: Session = Depends(get_db)) -> dict[str, str]:
    ensure_default_categories(db, user.id)
    delete_category_row(db, user.id, category_id)
    return {"status": "ok"}


@router.patch("/subcategories/{subcategory_id}", response_model=BankingSubcategoryOut)
def banking_patch_subcategory(
    subcategory_id: int,
    body: BankingSubcategoryPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingSubcategoryOut:
    ensure_default_categories(db, user.id)
    if body.name is None and body.category_id is None and body.enabled is None:
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    patch_subcategory_row(
        db,
        user.id,
        subcategory_id,
        name=body.name,
        category_id=body.category_id,
        enabled=body.enabled,
    )
    nested = list_categories_nested(db, user.id)
    for cat in nested:
        for s in cat["subcategories"]:
            if s["id"] == subcategory_id:
                return BankingSubcategoryOut(**s)
    raise HTTPException(status_code=404, detail="Subcategoría no encontrada")


@router.delete("/subcategories/{subcategory_id}")
def banking_delete_subcategory(subcategory_id: int, user: BankingUser, db: Session = Depends(get_db)) -> dict[str, str]:
    ensure_default_categories(db, user.id)
    delete_subcategory_row(db, user.id, subcategory_id)
    return {"status": "ok"}


@router.get("/credit-card/unpaid-grouped", response_model=BankingCreditCardUnpaidGroupedResponse)
def banking_credit_card_unpaid_grouped(
    user: BankingUser,
    db: Session = Depends(get_db),
    balance_scope: str = Query("ledger", description="Filtra cargos con mes contable en curso o anterior; coherente con /banking/accounts."),
) -> BankingCreditCardUnpaidGroupedResponse:
    ensure_default_categories(db, user.id)
    v = _parse_balance_scope(balance_scope)
    raw = banking_credit_card_unpaid_groups_payload(
        db, user.id, through_current_accounting_month=(v == "through_current_accounting_month")
    )
    return BankingCreditCardUnpaidGroupedResponse(
        groups=[
            BankingCreditCardUnpaidGroupOut(
                account_id=int(g["account_id"]),
                account_name=str(g["account_name"]),
                items=[BankingTransactionOut.model_validate(x) for x in g["items"]],
            )
            for g in raw
        ]
    )


@router.get("/provisions/pending-reversal-grouped", response_model=BankingCreditCardUnpaidGroupedResponse)
def banking_provisions_pending_reversal_grouped(user: BankingUser, db: Session = Depends(get_db)) -> BankingCreditCardUnpaidGroupedResponse:
    """Provisiones originales sin reversa automática registrada; agrupadas por cuenta."""
    ensure_default_categories(db, user.id)
    raw = banking_provisions_pending_reversal_groups_payload(db, user.id)
    return BankingCreditCardUnpaidGroupedResponse(groups=raw)


@router.get("/shared/unsettled-grouped", response_model=BankingSharedUnsettledGroupedResponse)
def banking_shared_unsettled_grouped(user: BankingUser, db: Session = Depends(get_db)) -> BankingSharedUnsettledGroupedResponse:
    ensure_default_categories(db, user.id)
    raw = banking_shared_unsettled_groups_payload(db, user.id)
    return BankingSharedUnsettledGroupedResponse(
        groups=[
            BankingCreditCardUnpaidGroupOut(
                account_id=int(g["account_id"]),
                account_name=str(g["account_name"]),
                items=[BankingTransactionOut.model_validate(x) for x in g["items"]],
            )
            for g in raw
        ]
    )


@router.post("/transactions/bulk-reverse-provision", response_model=BankingBulkReverseProvisionOut)
def banking_transactions_bulk_reverse_provision(
    body: BankingBulkReverseProvisionBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingBulkReverseProvisionOut:
    ensure_default_categories(db, user.id)
    n = banking_bulk_reverse_provision(db, user.id, body.transaction_ids)
    return BankingBulkReverseProvisionOut(created=n)


@router.post("/transactions/bulk-shared-settled", response_model=BankingBulkSharedSettledOut)
def banking_transactions_bulk_shared_settled(
    body: BankingBulkSharedSettledBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingBulkSharedSettledOut:
    ensure_default_categories(db, user.id)
    n = banking_bulk_set_shared_expense_settled(db, user.id, body.transaction_ids)
    return BankingBulkSharedSettledOut(updated=n)


@router.get("/transactions", response_model=BankingTransactionListOut)
def banking_list_transactions(
    user: BankingUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    account_id: int | None = Query(None),
    account_ids: Annotated[list[int] | None, Query()] = None,
    scope: str | None = Query(None, description="credit_card | shared | provisiones. Vacío = todos."),
    full_history: bool = Query(
        False,
        description="Si true, no acota por fechas. Si false, rango explícito o predeterminado (últimos 60 días por fecha del movimiento).",
    ),
    date_from: str | None = Query(None, description="YYYY-MM-DD inicio inclusive (fecha del movimiento); junto con date_to."),
    date_to: str | None = Query(None, description="YYYY-MM-DD fin inclusive."),
    accounting_month_from: str | None = Query(None, description="Opcional avanzado: YYYY-MM (prioridad sobre date_from/date_to si ambos pares existen)."),
    accounting_month_to: str | None = Query(None, description="Opcional avanzado: YYYY-MM."),
    description: str | None = Query(None, description="Filtro contiene texto en descripción."),
    amount_min: float | None = Query(None),
    amount_max: float | None = Query(None),
    tx_date_from: str | None = Query(None, description="Filtro de columna Fecha: inicio inclusive."),
    tx_date_to: str | None = Query(None, description="Filtro de columna Fecha: fin inclusive."),
    category_ids: Annotated[list[int] | None, Query()] = None,
    subcategory_ids: Annotated[list[int] | None, Query()] = None,
    shared_scopes: Annotated[list[str] | None, Query()] = None,
    liquidado_values: Annotated[list[str] | None, Query()] = None,
    tc_paid_values: Annotated[list[str] | None, Query()] = None,
    accounting_months: Annotated[list[str] | None, Query()] = None,
    db: Session = Depends(get_db),
) -> BankingTransactionListOut:
    ensure_default_categories(db, user.id)
    if scope not in (None, "", "credit_card", "shared", "provisiones"):
        raise HTTPException(
            status_code=400,
            detail="Parámetro scope inválido (use credit_card, shared, provisiones u omita).",
        )
    cc_scope = scope == "credit_card"
    shared_scope = scope == "shared"
    prov_scope = scope == "provisiones"
    acc_filter: list[int] | None = None
    if account_ids:
        acc_filter = list(dict.fromkeys(account_ids))
    elif account_id is not None:
        acc_filter = [account_id]
    q = db.query(BankingTransaction).filter(BankingTransaction.user_id == user.id)
    if acc_filter is not None:
        q = q.filter(BankingTransaction.account_id.in_(acc_filter))
    if cc_scope:
        q = banking_apply_credit_card_transaction_scope(db, user.id, q)
    elif shared_scope:
        q = banking_apply_shared_transaction_scope(db, user.id, q)
    elif prov_scope:
        q = banking_apply_provision_transaction_scope(db, user.id, q)
    cq = db.query(func.count(BankingTransaction.id)).filter(BankingTransaction.user_id == user.id)
    if acc_filter is not None:
        cq = cq.filter(BankingTransaction.account_id.in_(acc_filter))
    if cc_scope:
        cq = banking_apply_credit_card_transaction_scope(db, user.id, cq)
    elif shared_scope:
        cq = banking_apply_shared_transaction_scope(db, user.id, cq)
    elif prov_scope:
        cq = banking_apply_provision_transaction_scope(db, user.id, cq)
    scope_expr = _banking_transactions_scope_expr(
        full_history=full_history,
        accounting_month_from=accounting_month_from,
        accounting_month_to=accounting_month_to,
        date_from=date_from,
        date_to=date_to,
    )
    if scope_expr is not None:
        q = q.filter(scope_expr)
        cq = cq.filter(scope_expr)
    for expr in _banking_transactions_column_filter_exprs(
        description=description,
        amount_min=amount_min,
        amount_max=amount_max,
        tx_date_from=tx_date_from,
        tx_date_to=tx_date_to,
        category_ids=category_ids,
        subcategory_ids=subcategory_ids,
        shared_scopes=shared_scopes,
        liquidado_values=liquidado_values,
        tc_paid_values=tc_paid_values,
        accounting_months=accounting_months,
    ):
        q = q.filter(expr)
        cq = cq.filter(expr)
    n = cq.scalar() or 0
    rows = (
        q.order_by(
            BankingTransaction.fecha.desc(),
            BankingTransaction.created_at.desc(),
            BankingTransaction.id.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [BankingTransactionOut.model_validate(transaction_to_out(db, t)) for t in rows]
    return BankingTransactionListOut(items=items, total=n, page=page, page_size=page_size)


@router.post("/transactions", response_model=BankingTransactionOut)
def banking_create_transaction(
    body: BankingTransactionCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingTransactionOut:
    ensure_default_categories(db, user.id)
    tx = create_transaction_row(
        db,
        user.id,
        account_id=body.account_id,
        fecha=body.fecha,
        amount=float(body.amount),
        description=body.description,
        category_id=body.category_id,
        subcategory_id=body.subcategory_id,
        is_shared=body.is_shared,
        split_participants=body.split_participants,
        shared_expense_settled=body.shared_expense_settled,
        credit_card_charge_paid=body.credit_card_charge_paid,
        accounting_month=body.accounting_month,
        transfer_destination_account_id=body.transfer_destination_account_id,
    )
    return BankingTransactionOut.model_validate(transaction_to_out(db, tx))


@router.post("/transactions/{tx_id}/reverse-provision", response_model=BankingTransactionOut)
def banking_reverse_provision(
    tx_id: int,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingTransactionOut:
    ensure_default_categories(db, user.id)
    tx = reverse_provision_transaction_row(db, user.id, tx_id)
    return BankingTransactionOut.model_validate(transaction_to_out(db, tx))


@router.patch("/transactions/{tx_id}", response_model=BankingTransactionOut)
def banking_patch_transaction(
    tx_id: int,
    body: BankingTransactionPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> BankingTransactionOut:
    ensure_default_categories(db, user.id)
    if not any(
        [
            body.account_id is not None,
            body.fecha is not None,
            body.amount is not None,
            body.description is not None,
            body.category_id is not None,
            body.subcategory_id is not None,
            body.is_shared is not None,
            body.split_participants is not None,
            body.shared_expense_settled is not None,
            body.credit_card_charge_paid is not None,
            body.accounting_month is not None,
        ]
    ):
        raise HTTPException(status_code=400, detail="Nada que actualizar")
    tx = patch_transaction_row(
        db,
        user.id,
        tx_id,
        account_id=body.account_id,
        fecha=body.fecha,
        amount=body.amount,
        description=body.description,
        category_id=body.category_id,
        subcategory_id=body.subcategory_id,
        is_shared=body.is_shared,
        split_participants=body.split_participants,
        shared_expense_settled=body.shared_expense_settled,
        credit_card_charge_paid=body.credit_card_charge_paid,
        accounting_month=body.accounting_month,
    )
    return BankingTransactionOut.model_validate(transaction_to_out(db, tx))


@router.delete("/transactions/{tx_id}")
def banking_delete_transaction(
    tx_id: int,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    delete_transaction_row(db, user.id, tx_id)
    return {"status": "ok"}
