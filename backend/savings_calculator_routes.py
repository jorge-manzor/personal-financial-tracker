from __future__ import annotations

import math
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from auth import BankingUser
from database import get_db
from models import SavingsCalculatorPlan
from schemas import SavingsCalculatorChartPoint, SavingsCalculatorPlanCreate, SavingsCalculatorPlanOut, SavingsCalculatorPlanPatch

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


_MONTH_ES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")


def _month_label(d: date) -> str:
    return f"{_MONTH_ES[d.month - 1]} {d.year}"


def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _add_months_first(sn: date, months_to_add: int) -> date:
    """sn debe ser día 1. Devuelve el día 1 del mes tras sumar meses."""
    total = sn.year * 12 + sn.month - 1 + months_to_add
    y = total // 12
    m = total % 12 + 1
    return date(y, m, 1)


def inclusive_month_count(start: date, end: date) -> int:
    if end < start:
        return 0
    sn = _first_of_month(start)
    en = _first_of_month(end)
    return (en.year - sn.year) * 12 + (en.month - sn.month) + 1


def _validate_plan_fields(
    *,
    mode: str,
    start_date: date,
    end_date: date | None,
    monthly_amount_clp: float,
    target_amount_clp: float | None,
    initial_balance_clp: float,
) -> None:
    if initial_balance_clp < 0:
        raise HTTPException(status_code=400, detail="El saldo inicial no puede ser negativo.")
    if monthly_amount_clp <= 0:
        raise HTTPException(status_code=400, detail="El monto mensual debe ser mayor que cero.")
    if mode == "end_date":
        if end_date is None:
            raise HTTPException(status_code=400, detail="Indica la fecha final.")
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="La fecha fin no puede ser anterior al inicio.")
        if inclusive_month_count(start_date, end_date) < 1:
            raise HTTPException(status_code=400, detail="El rango debe cubrir al menos un mes.")
    elif mode == "target_amount":
        if target_amount_clp is None or target_amount_clp <= 0:
            raise HTTPException(status_code=400, detail="Indica el monto objetivo mayor que cero.")
        if end_date is not None:
            raise HTTPException(status_code=400, detail="En modo meta no uses fecha fin.")
    else:
        raise HTTPException(status_code=400, detail="Modo de simulación inválido.")


def row_to_out(row: SavingsCalculatorPlan) -> SavingsCalculatorPlanOut:
    mode = row.mode
    start = row.start_date
    monthly = float(row.monthly_amount_clp)
    initial = float(getattr(row, "initial_balance_clp", 0) or 0)
    end_d = row.end_date
    target = float(row.target_amount_clp) if row.target_amount_clp is not None else None

    chart: list[SavingsCalculatorChartPoint] = []
    months_count: int | None = None
    total_projected: float | None = None
    months_needed: int | None = None
    total_at_goal: float | None = None

    sn = _first_of_month(start)

    if mode == "end_date" and end_d is not None:
        mc = inclusive_month_count(start, end_d)
        months_count = mc
        total_projected = initial + mc * monthly
        for i in range(mc):
            d = _add_months_first(sn, i)
            cum = initial + (i + 1) * monthly
            chart.append(SavingsCalculatorChartPoint(period_index=i, period_label=_month_label(d), cumulative_clp=cum))

    elif mode == "target_amount" and target is not None:
        remaining = target - initial
        if remaining <= 0:
            months_needed = 0
            total_at_goal = initial
            chart.append(
                SavingsCalculatorChartPoint(period_index=0, period_label=_month_label(sn), cumulative_clp=initial)
            )
        else:
            mn = int(math.ceil(remaining / monthly))
            months_needed = max(1, mn)
            total_at_goal = initial + months_needed * monthly
            for i in range(months_needed):
                d = _add_months_first(sn, i)
                cum = initial + (i + 1) * monthly
                chart.append(
                    SavingsCalculatorChartPoint(period_index=i, period_label=_month_label(d), cumulative_clp=cum)
                )

    return SavingsCalculatorPlanOut(
        id=int(row.id),
        name=str(row.name).strip(),
        mode=mode,  # type: ignore[arg-type]
        start_date=start,
        end_date=end_d,
        monthly_amount_clp=monthly,
        initial_balance_clp=initial,
        target_amount_clp=target,
        months_count=months_count,
        total_projected_clp=total_projected,
        months_needed=months_needed,
        total_at_goal_clp=total_at_goal,
        chart=chart,
    )


@router.get("/savings-calculator/plans", response_model=list[SavingsCalculatorPlanOut])
def list_plans(user: BankingUser, db: Session = Depends(get_db)) -> list[SavingsCalculatorPlanOut]:
    rows = (
        db.query(SavingsCalculatorPlan)
        .filter(SavingsCalculatorPlan.user_id == user.id)
        .order_by(SavingsCalculatorPlan.created_at.desc(), SavingsCalculatorPlan.id.desc())
        .all()
    )
    return [row_to_out(r) for r in rows]


@router.post("/savings-calculator/plans", response_model=SavingsCalculatorPlanOut)
def create_plan(body: SavingsCalculatorPlanCreate, user: BankingUser, db: Session = Depends(get_db)) -> SavingsCalculatorPlanOut:
    _validate_plan_fields(
        mode=body.mode,
        start_date=body.start_date,
        end_date=body.end_date,
        monthly_amount_clp=body.monthly_amount_clp,
        target_amount_clp=body.target_amount_clp,
        initial_balance_clp=float(body.initial_balance_clp),
    )
    ts = _now()
    row = SavingsCalculatorPlan(
        user_id=user.id,
        name=body.name.strip(),
        mode=body.mode,
        start_date=body.start_date,
        end_date=body.end_date if body.mode == "end_date" else None,
        monthly_amount_clp=float(body.monthly_amount_clp),
        initial_balance_clp=float(body.initial_balance_clp),
        target_amount_clp=float(body.target_amount_clp) if body.mode == "target_amount" else None,
        created_at=ts,
        updated_at=ts,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row_to_out(row)


@router.patch("/savings-calculator/plans/{plan_id}", response_model=SavingsCalculatorPlanOut)
def patch_plan(
    plan_id: int,
    body: SavingsCalculatorPlanPatch,
    user: BankingUser,
    db: Session = Depends(get_db),
) -> SavingsCalculatorPlanOut:
    row = (
        db.query(SavingsCalculatorPlan)
        .filter(SavingsCalculatorPlan.id == plan_id, SavingsCalculatorPlan.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Plan no encontrado.")

    name = body.name.strip() if body.name is not None else row.name
    mode = body.mode if body.mode is not None else row.mode
    start_date = body.start_date if body.start_date is not None else row.start_date
    monthly = float(body.monthly_amount_clp) if body.monthly_amount_clp is not None else float(row.monthly_amount_clp)
    initial_bal = (
        float(body.initial_balance_clp)
        if body.initial_balance_clp is not None
        else float(getattr(row, "initial_balance_clp", 0) or 0)
    )

    end_date: date | None
    target_val: float | None

    if mode == "target_amount":
        end_date = None
        if body.target_amount_clp is not None:
            target_val = float(body.target_amount_clp)
        else:
            target_val = float(row.target_amount_clp) if row.target_amount_clp is not None else None
    else:
        target_val = None
        end_date = body.end_date if body.end_date is not None else row.end_date

    row.name = name  # type: ignore[assignment]
    row.mode = mode
    row.start_date = start_date
    row.end_date = end_date
    row.monthly_amount_clp = monthly
    row.initial_balance_clp = initial_bal
    row.target_amount_clp = target_val

    _validate_plan_fields(
        mode=mode,
        start_date=start_date,
        end_date=row.end_date,
        monthly_amount_clp=monthly,
        target_amount_clp=row.target_amount_clp,
        initial_balance_clp=initial_bal,
    )

    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row_to_out(row)


@router.delete("/savings-calculator/plans/{plan_id}", status_code=204, response_class=Response)
def delete_plan(plan_id: int, user: BankingUser, db: Session = Depends(get_db)) -> Response:
    row = (
        db.query(SavingsCalculatorPlan)
        .filter(SavingsCalculatorPlan.id == plan_id, SavingsCalculatorPlan.user_id == user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Plan no encontrado.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
