"""Hierarchical Digital Twin REST API endpoints."""

from datetime import datetime
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Factory, Machine, MachineEvent, Region, ShiftSchedule, ShiftTransitionLog
from app.models_ps032 import UserAccount
from app.schemas import (
    CompanyHierarchyDTO,
    CompanyOverviewDTO,
    FactoryDetailDTO,
    MachineDetailDTO,
    MachineEventDTO,
    ProductionLineDetailDTO,
    RegionDetailDTO,
    ShiftContextDTO,
    ShiftScheduleCreateDTO,
    ShiftScheduleUpdateDTO,
    ShiftWindowDTO,
)
from app.services.access_control import (
    assert_factory_access,
    assert_machine_access,
    assert_region_access,
    get_permitted_machine_ids,
)
from app.services.auth_service import get_optional_user, normalize_role
from app.services.shift_engine import resolve_shift_context, _to_window_dto
from app.services.telemetry_service import (
    build_company_hierarchy,
    build_company_overview,
    build_factory_detail,
    build_line_detail,
    build_machine_detail,
    build_region_detail,
)

router = APIRouter(prefix="/api/dt", tags=["digital-twin"])


@router.get("/company", response_model=CompanyOverviewDTO)
def get_company_overview(db: Session = Depends(get_db)):
    try:
        return build_company_overview(db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/hierarchy", response_model=CompanyHierarchyDTO)
def get_company_hierarchy(
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    try:
        permitted = get_permitted_machine_ids(db, user) if user is not None else None
        return build_company_hierarchy(db, permitted_machine_ids=permitted)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/regions/{region_id}", response_model=RegionDetailDTO)
def get_region_detail(
    region_id: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    permitted = None
    if user is not None:
        assert_region_access(db, user, region_id)
        permitted = get_permitted_machine_ids(db, user)
    region = build_region_detail(db, region_id, permitted_machine_ids=permitted)
    if region is None:
        raise HTTPException(status_code=404, detail=f"Region {region_id} not found")
    return region


@router.get("/factories/{factory_id}", response_model=FactoryDetailDTO)
def get_factory_detail(
    factory_id: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    permitted = None
    if user is not None:
        assert_factory_access(db, user, factory_id)
        permitted = get_permitted_machine_ids(db, user)
    factory = build_factory_detail(db, factory_id, permitted_machine_ids=permitted)
    if factory is None:
        raise HTTPException(status_code=404, detail=f"Factory {factory_id} not found")
    return factory


@router.get("/lines/{line_id}", response_model=ProductionLineDetailDTO)
def get_line_detail(
    line_id: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    line = build_line_detail(db, line_id)
    if line is None:
        raise HTTPException(status_code=404, detail=f"Production line {line_id} not found")
    if user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            filtered = [m for m in line.machines if m.id in permitted]
            if not filtered:
                raise HTTPException(status_code=403, detail=f"Access denied to production line '{line_id}'.")
            line.machines = filtered
    return line


@router.get("/machines/{machine_id}", response_model=MachineDetailDTO)
def get_machine_detail(
    machine_id: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    if user is not None:
        assert_machine_access(db, user, machine_id)
    machine = build_machine_detail(db, machine_id)
    if machine is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return machine


@router.get("/machines/by-qr/{qr_token}", response_model=MachineDetailDTO)
def get_machine_by_qr(
    qr_token: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    machine = db.scalar(select(Machine).where(Machine.qr_token == qr_token))
    if machine is None:
        raise HTTPException(status_code=404, detail=f"QR token {qr_token} not found")
    if user is not None:
        assert_machine_access(db, user, machine.id)
    detail = build_machine_detail(db, machine.id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine.id} not found")
    return detail


@router.get("/events", response_model=list[MachineEventDTO])
def list_events(
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(default=60, ge=1, le=200),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(MachineEvent).order_by(desc(MachineEvent.timestamp), desc(MachineEvent.id)).limit(limit)
    if user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(MachineEvent.machine_id.in_(permitted or {"__none__"}))
    if region_id:
        stmt = stmt.where(MachineEvent.region_id == region_id)
    if factory_id:
        stmt = stmt.where(MachineEvent.factory_id == factory_id)
    if line_id:
        stmt = stmt.where(MachineEvent.line_id == line_id)
    if machine_id:
        stmt = stmt.where(MachineEvent.machine_id == machine_id)
    if severity:
        stmt = stmt.where(MachineEvent.severity == severity)
    events = list(db.scalars(stmt))
    return [MachineEventDTO.model_validate(e) for e in events]


@router.get("/shifts/context", response_model=ShiftContextDTO)
def get_shift_context(
    region_id: str,
    factory_id: Optional[str] = None,
    at_iso: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if db.get(Region, region_id) is None:
        raise HTTPException(status_code=404, detail=f"Region {region_id} not found")
    if factory_id and db.get(Factory, factory_id) is None:
        raise HTTPException(status_code=404, detail=f"Factory {factory_id} not found")
    at_dt = datetime.fromisoformat(at_iso) if at_iso else None
    return resolve_shift_context(db, region_id, factory_id, at_utc=at_dt)


@router.post("/shifts", response_model=ShiftWindowDTO, status_code=201)
def create_shift_schedule(payload: ShiftScheduleCreateDTO, db: Session = Depends(get_db)):
    if db.get(Region, payload.region_id) is None:
        raise HTTPException(status_code=404, detail=f"Region {payload.region_id} not found")
    if payload.factory_id and db.get(Factory, payload.factory_id) is None:
        raise HTTPException(status_code=404, detail=f"Factory {payload.factory_id} not found")

    schedule = ShiftSchedule(
        id=f"sh-{uuid.uuid4().hex[:8]}",
        region_id=payload.region_id,
        factory_id=payload.factory_id,
        shift_name=payload.shift_name,
        start_time=payload.start_time,
        end_time=payload.end_time,
        timezone=payload.timezone,
        supervisor=payload.supervisor,
        assigned_operators=payload.assigned_operators,
        handover_deadline_minutes=payload.handover_deadline_minutes,
        is_active=True,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return _to_window_dto(schedule)


@router.patch("/shifts/{schedule_id}", response_model=ShiftWindowDTO)
def update_shift_schedule(
    schedule_id: str,
    payload: ShiftScheduleUpdateDTO,
    db: Session = Depends(get_db),
):
    schedule = db.get(ShiftSchedule, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail=f"Shift schedule {schedule_id} not found")
    for field, val in payload.model_dump(exclude_unset=True).items():
        setattr(schedule, field, val)
    db.commit()
    db.refresh(schedule)
    return _to_window_dto(schedule)


@router.get("/shift-transitions")
def list_shift_transitions(limit: int = Query(default=25, ge=1, le=100), db: Session = Depends(get_db)):
    logs = list(
        db.scalars(select(ShiftTransitionLog).order_by(desc(ShiftTransitionLog.transitioned_at)).limit(limit))
    )
    return [
        {
            "id": log.id,
            "region_id": log.region_id,
            "factory_id": log.factory_id,
            "previous_shift_name": log.previous_shift_name,
            "new_shift_name": log.new_shift_name,
            "timezone": log.timezone,
            "machines_flagged_pending": log.machines_flagged_pending,
            "notes": log.notes,
            "transitioned_at": log.transitioned_at,
        }
        for log in logs
    ]

