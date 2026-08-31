from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from auth import ProyectosUser
from database import get_db
from models import Project, ProjectContribution, ProjectItem, ProjectItemPayment
from schemas import (
    ProjectContributionCreate,
    ProjectContributionPatch,
    ProjectCreate,
    ProjectItemCreate,
    ProjectItemOut,
    ProjectItemPatch,
    ProjectItemPaymentCreate,
    ProjectItemPaymentPatch,
    ProjectListOut,
    ProjectOut,
    ProjectPatch,
)

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_project_or_404(db: Session, project_id: int, user_id: int) -> Project:
    row = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")
    return row


def _get_item_or_404(db: Session, project: Project, item_id: int) -> ProjectItem:
    row = db.query(ProjectItem).filter(ProjectItem.id == item_id, ProjectItem.project_id == project.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Ítem no encontrado.")
    return row


def _item_payments(db: Session, item_id: int) -> list[ProjectItemPayment]:
    return (
        db.query(ProjectItemPayment)
        .filter(ProjectItemPayment.item_id == item_id)
        .order_by(ProjectItemPayment.fecha.asc(), ProjectItemPayment.id.asc())
        .all()
    )


def item_row_to_out(item: ProjectItem, payments: list[ProjectItemPayment]) -> ProjectItemOut:
    monto_pagado = sum(float(p.amount) for p in payments)
    return ProjectItemOut(
        id=int(item.id),
        project_id=int(item.project_id),
        name=str(item.name),
        costo_total=float(item.costo_total),
        fecha_limite=item.fecha_limite,
        sort_order=int(item.sort_order),
        monto_pagado=monto_pagado,
        monto_restante=float(item.costo_total) - monto_pagado,
        payments=[
            {
                "id": p.id,
                "item_id": p.item_id,
                "amount": float(p.amount),
                "fecha": p.fecha,
                "note": p.note,
                "created_at": p.created_at,
            }
            for p in payments
        ],
    )


def project_row_to_out(db: Session, project: Project) -> ProjectOut:
    contributions = (
        db.query(ProjectContribution)
        .filter(ProjectContribution.project_id == project.id)
        .order_by(ProjectContribution.fecha.asc(), ProjectContribution.id.asc())
        .all()
    )
    items = (
        db.query(ProjectItem)
        .filter(ProjectItem.project_id == project.id)
        .order_by(ProjectItem.sort_order.asc(), ProjectItem.id.asc())
        .all()
    )
    items_out = [item_row_to_out(it, _item_payments(db, it.id)) for it in items]

    presupuesto_total = sum(float(c.amount) for c in contributions)
    comprometido = sum(it.costo_total for it in items_out)
    pagado = sum(it.monto_pagado for it in items_out)

    return ProjectOut(
        id=int(project.id),
        name=str(project.name),
        description=project.description,
        is_archived=bool(project.is_archived),
        created_at=project.created_at,
        updated_at=project.updated_at,
        presupuesto_total=presupuesto_total,
        comprometido=comprometido,
        pagado=pagado,
        disponible=presupuesto_total - comprometido,
        contributions=[
            {
                "id": c.id,
                "project_id": c.project_id,
                "amount": float(c.amount),
                "fecha": c.fecha,
                "note": c.note,
                "created_at": c.created_at,
            }
            for c in contributions
        ],
        items=items_out,
    )


def project_row_to_list_out(db: Session, project: Project) -> ProjectListOut:
    contributions = db.query(ProjectContribution).filter(ProjectContribution.project_id == project.id).all()
    items = db.query(ProjectItem).filter(ProjectItem.project_id == project.id).all()
    item_ids = [it.id for it in items]
    payments = (
        db.query(ProjectItemPayment).filter(ProjectItemPayment.item_id.in_(item_ids)).all() if item_ids else []
    )

    presupuesto_total = sum(float(c.amount) for c in contributions)
    comprometido = sum(float(it.costo_total) for it in items)
    pagado = sum(float(p.amount) for p in payments)

    return ProjectListOut(
        id=int(project.id),
        name=str(project.name),
        description=project.description,
        is_archived=bool(project.is_archived),
        presupuesto_total=presupuesto_total,
        comprometido=comprometido,
        pagado=pagado,
        disponible=presupuesto_total - comprometido,
        items_count=len(items),
    )


@router.get("/projects", response_model=list[ProjectListOut])
def list_projects(user: ProyectosUser, db: Session = Depends(get_db)) -> list[ProjectListOut]:
    rows = (
        db.query(Project)
        .filter(Project.user_id == user.id)
        .order_by(Project.created_at.desc(), Project.id.desc())
        .all()
    )
    return [project_row_to_list_out(db, r) for r in rows]


@router.post("/projects", response_model=ProjectOut)
def create_project(body: ProjectCreate, user: ProyectosUser, db: Session = Depends(get_db)) -> ProjectOut:
    ts = _now()
    project = Project(
        user_id=user.id,
        name=body.name.strip(),
        description=body.description,
        is_archived=False,
        created_at=ts,
        updated_at=ts,
    )
    db.add(project)
    db.flush()

    if body.initial_contribution_amount is not None:
        db.add(
            ProjectContribution(
                project_id=project.id,
                amount=float(body.initial_contribution_amount),
                fecha=body.initial_contribution_fecha,
                note=None,
                created_at=ts,
            )
        )

    db.commit()
    db.refresh(project)
    return project_row_to_out(db, project)


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, user: ProyectosUser, db: Session = Depends(get_db)) -> ProjectOut:
    project = _get_project_or_404(db, project_id, user.id)
    return project_row_to_out(db, project)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def patch_project(
    project_id: int, body: ProjectPatch, user: ProyectosUser, db: Session = Depends(get_db)
) -> ProjectOut:
    project = _get_project_or_404(db, project_id, user.id)
    if body.name is not None:
        project.name = body.name.strip()  # type: ignore[assignment]
    if body.description is not None:
        project.description = body.description  # type: ignore[assignment]
    if body.is_archived is not None:
        project.is_archived = body.is_archived  # type: ignore[assignment]
    project.updated_at = _now()
    db.commit()
    db.refresh(project)
    return project_row_to_out(db, project)


@router.delete("/projects/{project_id}", status_code=204, response_class=Response)
def delete_project(project_id: int, user: ProyectosUser, db: Session = Depends(get_db)) -> Response:
    project = _get_project_or_404(db, project_id, user.id)
    item_ids = [row[0] for row in db.query(ProjectItem.id).filter(ProjectItem.project_id == project.id).all()]
    if item_ids:
        db.query(ProjectItemPayment).filter(ProjectItemPayment.item_id.in_(item_ids)).delete(
            synchronize_session=False
        )
        db.query(ProjectItem).filter(ProjectItem.project_id == project.id).delete(synchronize_session=False)
    db.query(ProjectContribution).filter(ProjectContribution.project_id == project.id).delete(
        synchronize_session=False
    )
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{project_id}/contributions", response_model=ProjectOut)
def create_contribution(
    project_id: int, body: ProjectContributionCreate, user: ProyectosUser, db: Session = Depends(get_db)
) -> ProjectOut:
    project = _get_project_or_404(db, project_id, user.id)
    db.add(
        ProjectContribution(
            project_id=project.id,
            amount=float(body.amount),
            fecha=body.fecha,
            note=body.note,
            created_at=_now(),
        )
    )
    project.updated_at = _now()
    db.commit()
    db.refresh(project)
    return project_row_to_out(db, project)


@router.patch("/projects/{project_id}/contributions/{contribution_id}", response_model=ProjectOut)
def patch_contribution(
    project_id: int,
    contribution_id: int,
    body: ProjectContributionPatch,
    user: ProyectosUser,
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = _get_project_or_404(db, project_id, user.id)
    row = (
        db.query(ProjectContribution)
        .filter(ProjectContribution.id == contribution_id, ProjectContribution.project_id == project.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Aporte no encontrado.")
    if body.amount is not None:
        row.amount = float(body.amount)  # type: ignore[assignment]
    if body.fecha is not None:
        row.fecha = body.fecha  # type: ignore[assignment]
    if body.note is not None:
        row.note = body.note  # type: ignore[assignment]
    project.updated_at = _now()
    db.commit()
    db.refresh(project)
    return project_row_to_out(db, project)


@router.delete("/projects/{project_id}/contributions/{contribution_id}", status_code=204, response_class=Response)
def delete_contribution(
    project_id: int, contribution_id: int, user: ProyectosUser, db: Session = Depends(get_db)
) -> Response:
    project = _get_project_or_404(db, project_id, user.id)
    row = (
        db.query(ProjectContribution)
        .filter(ProjectContribution.id == contribution_id, ProjectContribution.project_id == project.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Aporte no encontrado.")
    db.delete(row)
    project.updated_at = _now()
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{project_id}/items", response_model=ProjectItemOut)
def create_item(
    project_id: int, body: ProjectItemCreate, user: ProyectosUser, db: Session = Depends(get_db)
) -> ProjectItemOut:
    project = _get_project_or_404(db, project_id, user.id)
    ts = _now()
    max_sort = (
        db.query(ProjectItem.sort_order)
        .filter(ProjectItem.project_id == project.id)
        .order_by(ProjectItem.sort_order.desc())
        .first()
    )
    next_sort = (max_sort[0] + 1) if max_sort is not None else 0

    item = ProjectItem(
        project_id=project.id,
        name=body.name.strip(),
        costo_total=float(body.costo_total),
        fecha_limite=body.fecha_limite,
        sort_order=next_sort,
        created_at=ts,
        updated_at=ts,
    )
    db.add(item)
    db.flush()

    if body.initial_payment_amount is not None:
        db.add(
            ProjectItemPayment(
                item_id=item.id,
                amount=float(body.initial_payment_amount),
                fecha=body.initial_payment_fecha,
                note=None,
                created_at=ts,
            )
        )

    project.updated_at = ts
    db.commit()
    db.refresh(item)
    return item_row_to_out(item, _item_payments(db, item.id))


@router.patch("/projects/{project_id}/items/{item_id}", response_model=ProjectItemOut)
def patch_item(
    project_id: int, item_id: int, body: ProjectItemPatch, user: ProyectosUser, db: Session = Depends(get_db)
) -> ProjectItemOut:
    project = _get_project_or_404(db, project_id, user.id)
    item = _get_item_or_404(db, project, item_id)
    if body.name is not None:
        item.name = body.name.strip()  # type: ignore[assignment]
    if body.costo_total is not None:
        item.costo_total = float(body.costo_total)  # type: ignore[assignment]
    if body.fecha_limite is not None:
        item.fecha_limite = body.fecha_limite  # type: ignore[assignment]
    if body.sort_order is not None:
        item.sort_order = body.sort_order  # type: ignore[assignment]
    item.updated_at = _now()
    project.updated_at = _now()
    db.commit()
    db.refresh(item)
    return item_row_to_out(item, _item_payments(db, item.id))


@router.delete("/projects/{project_id}/items/{item_id}", status_code=204, response_class=Response)
def delete_item(project_id: int, item_id: int, user: ProyectosUser, db: Session = Depends(get_db)) -> Response:
    project = _get_project_or_404(db, project_id, user.id)
    item = _get_item_or_404(db, project, item_id)
    db.query(ProjectItemPayment).filter(ProjectItemPayment.item_id == item.id).delete(synchronize_session=False)
    db.delete(item)
    project.updated_at = _now()
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{project_id}/items/{item_id}/payments", response_model=ProjectItemOut)
def create_payment(
    project_id: int,
    item_id: int,
    body: ProjectItemPaymentCreate,
    user: ProyectosUser,
    db: Session = Depends(get_db),
) -> ProjectItemOut:
    project = _get_project_or_404(db, project_id, user.id)
    item = _get_item_or_404(db, project, item_id)
    db.add(
        ProjectItemPayment(
            item_id=item.id,
            amount=float(body.amount),
            fecha=body.fecha,
            note=body.note,
            created_at=_now(),
        )
    )
    item.updated_at = _now()
    project.updated_at = _now()
    db.commit()
    db.refresh(item)
    return item_row_to_out(item, _item_payments(db, item.id))


@router.patch("/projects/{project_id}/items/{item_id}/payments/{payment_id}", response_model=ProjectItemOut)
def patch_payment(
    project_id: int,
    item_id: int,
    payment_id: int,
    body: ProjectItemPaymentPatch,
    user: ProyectosUser,
    db: Session = Depends(get_db),
) -> ProjectItemOut:
    project = _get_project_or_404(db, project_id, user.id)
    item = _get_item_or_404(db, project, item_id)
    row = (
        db.query(ProjectItemPayment)
        .filter(ProjectItemPayment.id == payment_id, ProjectItemPayment.item_id == item.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Abono no encontrado.")
    if body.amount is not None:
        row.amount = float(body.amount)  # type: ignore[assignment]
    if body.fecha is not None:
        row.fecha = body.fecha  # type: ignore[assignment]
    if body.note is not None:
        row.note = body.note  # type: ignore[assignment]
    item.updated_at = _now()
    project.updated_at = _now()
    db.commit()
    db.refresh(item)
    return item_row_to_out(item, _item_payments(db, item.id))


@router.delete("/projects/{project_id}/items/{item_id}/payments/{payment_id}", status_code=204, response_class=Response)
def delete_payment(
    project_id: int, item_id: int, payment_id: int, user: ProyectosUser, db: Session = Depends(get_db)
) -> Response:
    project = _get_project_or_404(db, project_id, user.id)
    item = _get_item_or_404(db, project, item_id)
    row = (
        db.query(ProjectItemPayment)
        .filter(ProjectItemPayment.id == payment_id, ProjectItemPayment.item_id == item.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Abono no encontrado.")
    db.delete(row)
    item.updated_at = _now()
    project.updated_at = _now()
    db.commit()
    return Response(status_code=204)
