"""Endpoints de la sección Analítica de Banking (Release 1). Ver docs/spec-analitica-banking-release-1.md."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from auth import BankingUser
from banking_analytics_service import category_summary, monthly_trend, parse_month_key
from banking_service import ensure_default_categories
from database import get_db
from schemas import BankingAnalyticsCategorySummaryOut, BankingAnalyticsMonthlyTrendOut

router = APIRouter()


def _resolve_month(month: str | None) -> tuple[int, int]:
    if month is None:
        today = datetime.now(ZoneInfo("America/Santiago")).date()
        return today.year, today.month
    try:
        return parse_month_key(month)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/analytics/category-summary", response_model=BankingAnalyticsCategorySummaryOut)
def banking_analytics_category_summary(
    user: BankingUser,
    db: Session = Depends(get_db),
    month: str | None = Query(default=None, description="YYYY-MM; por defecto el mes actual (hora Chile)."),
) -> BankingAnalyticsCategorySummaryOut:
    ensure_default_categories(db, user.id)
    year, m = _resolve_month(month)
    data = category_summary(db, user.id, year, m)
    return BankingAnalyticsCategorySummaryOut(**data)


@router.get("/analytics/monthly-trend", response_model=BankingAnalyticsMonthlyTrendOut)
def banking_analytics_monthly_trend(
    user: BankingUser,
    db: Session = Depends(get_db),
    month: str | None = Query(default=None, description="Último mes del rango, YYYY-MM; por defecto el mes actual."),
    meses: int = Query(default=6, ge=1, le=12, description="Tamaño del rango: 6 o 12 (US-03)."),
) -> BankingAnalyticsMonthlyTrendOut:
    ensure_default_categories(db, user.id)
    year, m = _resolve_month(month)
    data = monthly_trend(db, user.id, year, m, meses)
    return BankingAnalyticsMonthlyTrendOut(**data)
