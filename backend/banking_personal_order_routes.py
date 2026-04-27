from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from starlette.responses import Response

from auth import BankingUser
from banking_service import get_account_for_user
from database import get_db
from models import BankingAccount, BankingPersonalProvisionItem, BankingPersonalSavingsAdjustment, BankingPersonalSavingsGoal
from schemas import (
    PersonalProvisionItemCreate,
    PersonalProvisionItemOut,
    PersonalProvisionItemPatch,
    PersonalProvisionReorderBody,
    PersonalSavingsAdjustBody,
    PersonalSavingsGoalCreate,
    PersonalSavingsGoalOut,
    PersonalSavingsGoalPatch,
)

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _provision_row_to_out(db: Session, row: BankingPersonalProvisionItem) -> PersonalProvisionItemOut:
    acc_name = None
    if row.account_id is not None:
        a = db.query(BankingAccount).filter(BankingAccount.id == row.account_id).first()
        acc_name = a.name.strip() if a else None
    raw_lab = getattr(row, "category_label", None)
    label = raw_lab.strip() if isinstance(raw_lab, str) else None
    label = label or None
    return PersonalProvisionItemOut(
        id=int(row.id),
        description=str(row.description).strip(),
        account_id=int(row.account_id) if row.account_id is not None else None,
        account_name=acc_name,
        category_label=label,
        amount_clp=float(row.amount_clp) if row.amount_clp is not None else None,
        paid=bool(row.paid),
        sort_order=int(row.sort_order or 0),
    )


def _normalize_category_label(v: str | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    return s[:255]


@router.get("/personal-order/provision-items", response_model=list[PersonalProvisionItemOut])
def list_provision_items(user: BankingUser, db: Session = Depends(get_db)) -> list[PersonalProvisionItemOut]:
    rows = (
        db.query(BankingPersonalProvisionItem)
        .filter(BankingPersonalProvisionItem.user_id == user.id)
        .order_by(BankingPersonalProvisionItem.sort_order, BankingPersonalProvisionItem.id)
        .all()
    )
    return [_provision_row_to_out(db, r) for r in rows]


@router.post("/personal-order/provision-items", response_model=PersonalProvisionItemOut)
def create_provision_item(
    body: PersonalProvisionItemCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> PersonalProvisionItemOut:
    aid = body.account_id
    if aid is not None:
        if not get_account_for_user(db, user.id, aid):
            raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    max_sort = (
        db.query(BankingPersonalProvisionItem.sort_order)
        .filter(BankingPersonalProvisionItem.user_id == user.id)
        .order_by(BankingPersonalProvisionItem.sort_order.desc())
        .limit(1)
        .scalar()
    )
    so = int(max_sort or 0) + 1
    lab = _normalize_category_label(body.category_label)
    row = BankingPersonalProvisionItem(
        user_id=user.id,
        description=body.description.strip(),
        account_id=aid,
        category_id=None,
        subcategory_id=None,
        category_label=lab,
        amount_clp=float(body.amount_clp) if body.amount_clp is not None else None,
        paid=False,
        sort_order=so,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _provision_row_to_out(db, row)


@router.patch("/personal-order/provision-items/{item_id}", response_model=PersonalProvisionItemOut)
def patch_provision_item(
    item_id: int,
    body: PersonalProvisionItemPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> PersonalProvisionItemOut:
    row = (
        db.query(BankingPersonalProvisionItem)
        .filter(BankingPersonalProvisionItem.id == item_id, BankingPersonalProvisionItem.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ítem no encontrado.")
    patch_dict = body.model_dump(exclude_unset=True)
    if body.description is not None:
        row.description = body.description.strip()
    if "account_id" in patch_dict:
        if body.account_id is None:
            row.account_id = None
        else:
            if not get_account_for_user(db, user.id, body.account_id):
                raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
            row.account_id = body.account_id
    if "category_label" in patch_dict:
        row.category_label = _normalize_category_label(body.category_label)
        row.category_id = None
        row.subcategory_id = None
    if body.paid is not None:
        row.paid = body.paid
    if body.sort_order is not None:
        row.sort_order = body.sort_order
    if "amount_clp" in patch_dict:
        row.amount_clp = float(body.amount_clp) if body.amount_clp is not None else None
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _provision_row_to_out(db, row)


@router.post("/personal-order/provision-items/reorder", response_model=list[PersonalProvisionItemOut])
def reorder_provision_items(
    body: PersonalProvisionReorderBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> list[PersonalProvisionItemOut]:
    existing = (
        db.query(BankingPersonalProvisionItem).filter(BankingPersonalProvisionItem.user_id == user.id).all()
    )
    by_id = {int(r.id): r for r in existing}
    want = list(body.item_ids)
    if len(want) != len(by_id) or set(want) != set(by_id.keys()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enviá todos los ítems, cada uno una sola vez, en el orden deseado.",
        )
    now = _now()
    for i, iid in enumerate(want):
        by_id[iid].sort_order = i
        by_id[iid].updated_at = now
    db.commit()
    rows = (
        db.query(BankingPersonalProvisionItem)
        .filter(BankingPersonalProvisionItem.user_id == user.id)
        .order_by(BankingPersonalProvisionItem.sort_order, BankingPersonalProvisionItem.id)
        .all()
    )
    return [_provision_row_to_out(db, r) for r in rows]


@router.delete("/personal-order/provision-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_provision_item(item_id: int, user: BankingUser, db: Session = Depends(get_db)) -> Response:
    row = (
        db.query(BankingPersonalProvisionItem)
        .filter(BankingPersonalProvisionItem.id == item_id, BankingPersonalProvisionItem.user_id == user.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ítem no encontrado.")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/personal-order/provision-items/reset-paid", status_code=status.HTTP_204_NO_CONTENT)
def reset_all_provision_paid(user: BankingUser, db: Session = Depends(get_db)) -> Response:
    db.query(BankingPersonalProvisionItem).filter(BankingPersonalProvisionItem.user_id == user.id).update(
        {BankingPersonalProvisionItem.paid: False, BankingPersonalProvisionItem.updated_at: _now()},
        synchronize_session=False,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _savings_goal_to_out(db: Session, g: BankingPersonalSavingsGoal) -> PersonalSavingsGoalOut:
    acc = db.query(BankingAccount).filter(BankingAccount.id == g.account_id).first()
    name = acc.name.strip() if acc else ""
    return PersonalSavingsGoalOut(
        id=int(g.id),
        title=str(g.title).strip(),
        account_id=int(g.account_id),
        account_name=name,
        balance_clp=float(g.balance_clp or 0.0),
    )


@router.get("/personal-order/savings-goals", response_model=list[PersonalSavingsGoalOut])
def list_savings_goals(user: BankingUser, db: Session = Depends(get_db)) -> list[PersonalSavingsGoalOut]:
    rows = (
        db.query(BankingPersonalSavingsGoal)
        .filter(BankingPersonalSavingsGoal.user_id == user.id)
        .order_by(BankingPersonalSavingsGoal.id)
        .all()
    )
    return [_savings_goal_to_out(db, r) for r in rows]


@router.post("/personal-order/savings-goals", response_model=PersonalSavingsGoalOut)
def create_savings_goal(
    body: PersonalSavingsGoalCreate,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> PersonalSavingsGoalOut:
    if not get_account_for_user(db, user.id, body.account_id):
        raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
    bal = float(body.initial_balance_clp)
    goal = BankingPersonalSavingsGoal(
        user_id=user.id,
        account_id=body.account_id,
        title=body.title.strip(),
        balance_clp=bal,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(goal)
    db.flush()
    if bal != 0.0:
        db.add(
            BankingPersonalSavingsAdjustment(
                goal_id=int(goal.id),
                amount=bal,
                created_at=_now(),
            )
        )
    db.commit()
    db.refresh(goal)
    return _savings_goal_to_out(db, goal)


@router.patch("/personal-order/savings-goals/{goal_id}", response_model=PersonalSavingsGoalOut)
def patch_savings_goal(
    goal_id: int,
    body: PersonalSavingsGoalPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> PersonalSavingsGoalOut:
    g = (
        db.query(BankingPersonalSavingsGoal)
        .filter(BankingPersonalSavingsGoal.id == goal_id, BankingPersonalSavingsGoal.user_id == user.id)
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    if body.title is not None:
        g.title = body.title.strip()
    if body.account_id is not None:
        if not get_account_for_user(db, user.id, body.account_id):
            raise HTTPException(status_code=404, detail="Cuenta no encontrada.")
        g.account_id = body.account_id
    g.updated_at = _now()
    db.commit()
    db.refresh(g)
    return _savings_goal_to_out(db, g)


@router.post("/personal-order/savings-goals/{goal_id}/adjust", response_model=PersonalSavingsGoalOut)
def adjust_savings_goal(
    goal_id: int,
    body: PersonalSavingsAdjustBody,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> PersonalSavingsGoalOut:
    g = (
        db.query(BankingPersonalSavingsGoal)
        .filter(BankingPersonalSavingsGoal.id == goal_id, BankingPersonalSavingsGoal.user_id == user.id)
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    delta = float(body.amount)
    g.balance_clp = float(g.balance_clp or 0.0) + delta
    g.updated_at = _now()
    db.add(BankingPersonalSavingsAdjustment(goal_id=int(g.id), amount=delta, created_at=_now()))
    db.commit()
    db.refresh(g)
    return _savings_goal_to_out(db, g)


@router.delete("/personal-order/savings-goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_savings_goal(goal_id: int, user: BankingUser, db: Session = Depends(get_db)) -> Response:
    g = (
        db.query(BankingPersonalSavingsGoal)
        .filter(BankingPersonalSavingsGoal.id == goal_id, BankingPersonalSavingsGoal.user_id == user.id)
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    db.query(BankingPersonalSavingsAdjustment).filter(BankingPersonalSavingsAdjustment.goal_id == goal_id).delete(
        synchronize_session=False
    )
    db.delete(g)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
