"""PS-032 Expansion Routers: Assignments, My Machines/Reports, Downtime, Safety, PM Planner, Quality, Health, Energy, QR Passport, Analytics."""

from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Company, Factory, Machine, MachineEvent, ProductionLine, Region, ShiftSchedule
from app.models_ps032 import (
    Abnormality,
    AuditEvent,
    Cleaning5SLog,
    DowntimeEvent,
    HandoverRecord,
    MaintenanceRecord,
    MaintenanceSchedule,
    OperatorAssignment,
    ProductionEntry,
    QualityInspection,
    SafetyChecklist,
    UserAccount,
)
from app.schemas_ps032 import (
    AbnormalityDTO,
    AuditEventDTO,
    DowntimeCreateRequest,
    DowntimeEventDTO,
    DowntimeUpdateRequest,
    HandoverRecordDTO,
    MaintenanceScheduleCreateRequest,
    MaintenanceScheduleDTO,
    MaintenanceScheduleUpdateRequest,
    OperatorAssignmentCreateRequest,
    OperatorAssignmentDTO,
    OperatorAssignmentUpdateRequest,
    ProductionEntryDTO,
    QualityInspectionCreateRequest,
    QualityInspectionDTO,
    SafetyChecklistCreateRequest,
    SafetyChecklistDTO,
    SafetyChecklistReviewRequest,
    UserDTO,
)
from app.schemas import TelemetryIngestItem
from app.services.access_control import (
    assert_factory_access,
    assert_machine_access,
    assert_region_access,
    assert_user_management_scope,
    get_permitted_factory_ids,
    get_permitted_machine_ids,
)
from app.services.analytics_service import (
    build_factory_performance_analytics,
    compute_machine_energy,
    compute_machine_health,
)
from app.services.auth_service import (
    SUPERVISORY_ROLES,
    normalize_role,
    record_audit_event,
    require_current_user,
    require_roles,
)
from app.services.shift_engine import resolve_shift_context
from app.services.telemetry_service import _to_state_dto, ingest_telemetry_items
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api/ps032", tags=["ps032-expansion"])


def _load_machine_ctx(db: Session, machine_id: str):
    machine = db.scalar(
        select(Machine)
        .where(Machine.id == machine_id)
        .options(
            selectinload(Machine.state),
            selectinload(Machine.specification),
            selectinload(Machine.production_line).selectinload(ProductionLine.factory).selectinload(Factory.region),
        )
    )
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine '{machine_id}' not found.")
    line = machine.production_line
    factory = line.factory
    return machine, line, factory


def _assignment_to_dto(db: Session, a: OperatorAssignment) -> OperatorAssignmentDTO:
    u = db.get(UserAccount, a.user_id)
    m = db.get(Machine, a.machine_id) if a.machine_id else None
    return OperatorAssignmentDTO(
        id=a.id,
        user_id=a.user_id,
        user_name=u.name if u else None,
        user_role=u.role if u else None,
        employee_id=u.employee_id if u else None,
        machine_id=a.machine_id,
        machine_code=m.code if m else None,
        machine_name=m.name if m else None,
        line_id=a.line_id,
        factory_id=a.factory_id,
        shift_id=a.shift_id,
        shift_name=a.shift_name,
        assigned_by_id=a.assigned_by_id,
        assigned_by_name=a.assigned_by_name,
        start_date=a.start_date,
        end_date=a.end_date,
        is_active=a.is_active,
        notes=a.notes,
        created_at=a.created_at,
    )


def _schedule_to_dto(db: Session, s: MaintenanceSchedule) -> MaintenanceScheduleDTO:
    m = db.get(Machine, s.machine_id)
    now = datetime.now(timezone.utc)
    due = s.due_date.replace(tzinfo=timezone.utc) if s.due_date.tzinfo is None else s.due_date
    return MaintenanceScheduleDTO(
        id=s.id,
        machine_id=s.machine_id,
        machine_code=m.code if m else None,
        machine_name=m.name if m else None,
        factory_id=s.factory_id,
        title=s.title,
        maintenance_type=s.maintenance_type,
        frequency_days=s.frequency_days,
        due_date=s.due_date,
        next_service_date=s.next_service_date,
        assigned_engineer_id=s.assigned_engineer_id,
        assigned_engineer_name=s.assigned_engineer_name,
        last_completed_at=s.last_completed_at,
        status=s.status,
        is_overdue=(s.status != "completed" and due < now),
        linked_record_id=s.linked_record_id,
        created_at=s.created_at,
    )


# -----------------------------------------------------------------------------
# 1. Operator-to-Machine & Shift Assignments + My Machines / My Reports
# -----------------------------------------------------------------------------
@router.get("/assignments", response_model=list[OperatorAssignmentDTO])
def list_assignments(
    user_id: Optional[int] = None,
    machine_id: Optional[str] = None,
    active_only: bool = False,
    actor: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(OperatorAssignment).order_by(desc(OperatorAssignment.created_at))
    role = normalize_role(actor.role)
    if role in ("operator", "maintenance_engineer"):
        stmt = stmt.where(OperatorAssignment.user_id == actor.id)
    elif role == "factory_supervisor":
        if not actor.assigned_factory_id:
            return []
        stmt = stmt.where(OperatorAssignment.factory_id == actor.assigned_factory_id)
    elif role == "regional_manager":
        fac_ids = get_permitted_factory_ids(db, actor) or set()
        if not fac_ids:
            return []
        stmt = stmt.where(OperatorAssignment.factory_id.in_(fac_ids))

    if user_id is not None:
        stmt = stmt.where(OperatorAssignment.user_id == user_id)
    if machine_id:
        stmt = stmt.where(OperatorAssignment.machine_id == machine_id)
    if active_only:
        stmt = stmt.where(OperatorAssignment.is_active.is_(True))

    return [_assignment_to_dto(db, a) for a in db.scalars(stmt)]


@router.post("/assignments", response_model=OperatorAssignmentDTO, status_code=201)
def create_assignment(
    payload: OperatorAssignmentCreateRequest,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    target_user = db.get(UserAccount, payload.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found.")

    machine_id = payload.machine_id
    line_id = payload.line_id
    factory_id = payload.factory_id
    if machine_id:
        machine, line, factory = _load_machine_ctx(db, machine_id)
        line_id = line.id
        factory_id = factory.id
        assert_machine_access(db, actor, machine.id)
    elif factory_id:
        assert_factory_access(db, actor, factory_id)

    assert_user_management_scope(actor, target_user.role, target_user.assigned_region_id, factory_id or target_user.assigned_factory_id)

    shift_name = payload.shift_name
    if payload.shift_id and not shift_name:
        sched = db.get(ShiftSchedule, payload.shift_id)
        if sched:
            shift_name = sched.shift_name

    assignment = OperatorAssignment(
        user_id=target_user.id,
        machine_id=machine_id,
        line_id=line_id,
        factory_id=factory_id,
        shift_id=payload.shift_id,
        shift_name=shift_name,
        assigned_by_id=actor.id,
        assigned_by_name=actor.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        is_active=payload.is_active,
        notes=payload.notes,
    )
    db.add(assignment)
    db.flush()
    record_audit_event(
        db,
        action="operator_assigned",
        entity_type="assignment",
        entity_id=str(assignment.id),
        machine_id=machine_id,
        factory_id=factory_id,
        details=f"Assigned {target_user.name} ({target_user.role}) to {machine_id or line_id or factory_id} ({shift_name or 'All shifts'}).",
        user=actor,
    )
    db.commit()
    db.refresh(assignment)
    return _assignment_to_dto(db, assignment)


@router.patch("/assignments/{assignment_id}", response_model=OperatorAssignmentDTO)
def update_assignment(
    assignment_id: int,
    payload: OperatorAssignmentUpdateRequest,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    assignment = db.get(OperatorAssignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if assignment.machine_id:
        assert_machine_access(db, actor, assignment.machine_id)
    elif assignment.factory_id:
        assert_factory_access(db, actor, assignment.factory_id)

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(assignment, k, v)
    if payload.machine_id:
        _, line, factory = _load_machine_ctx(db, payload.machine_id)
        assert_machine_access(db, actor, payload.machine_id)
        assignment.line_id = line.id
        assignment.factory_id = factory.id

    record_audit_event(
        db,
        action="assignment_updated",
        entity_type="assignment",
        entity_id=str(assignment.id),
        machine_id=assignment.machine_id,
        factory_id=assignment.factory_id,
        details=f"Updated assignment #{assignment.id} (active={assignment.is_active}, shift={assignment.shift_name}).",
        user=actor,
    )
    db.commit()
    db.refresh(assignment)
    return _assignment_to_dto(db, assignment)


@router.delete("/assignments/{assignment_id}")
def delete_assignment(
    assignment_id: int,
    actor: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    assignment = db.get(OperatorAssignment, assignment_id)
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if assignment.machine_id:
        assert_machine_access(db, actor, assignment.machine_id)
    elif assignment.factory_id:
        assert_factory_access(db, actor, assignment.factory_id)

    assignment.is_active = False
    record_audit_event(
        db,
        action="assignment_removed",
        entity_type="assignment",
        entity_id=str(assignment.id),
        machine_id=assignment.machine_id,
        factory_id=assignment.factory_id,
        details=f"Deactivated assignment #{assignment.id} for user_id={assignment.user_id}.",
        user=actor,
    )
    db.commit()
    return {"message": f"Assignment #{assignment_id} deactivated."}


@router.get("/my-machines")
def get_my_machines(user: UserAccount = Depends(require_current_user), db: Session = Depends(get_db)):
    """Return ONLY the machines the authenticated user is permitted/assigned to operate or maintain."""
    permitted = get_permitted_machine_ids(db, user)
    stmt = select(Machine).options(
        selectinload(Machine.state),
        selectinload(Machine.production_line).selectinload(ProductionLine.factory).selectinload(Factory.region),
    )
    if permitted is not None:
        if not permitted:
            return {"user": {"id": user.id, "name": user.name, "role": user.role}, "machines": []}
        stmt = stmt.where(Machine.id.in_(permitted))

    machines = list(db.scalars(stmt.order_by(Machine.code.asc())))
    assignments = list(
        db.scalars(
            select(OperatorAssignment).where(
                OperatorAssignment.user_id == user.id,
                OperatorAssignment.is_active.is_(True),
            )
        )
    )
    shift_by_machine = {a.machine_id: a.shift_name for a in assignments if a.machine_id}

    result = []
    for m in machines:
        line = m.production_line
        fac = line.factory
        reg = fac.region
        shift_ctx = resolve_shift_context(db, reg.id, fac.id)
        health = compute_machine_health(db, m.id)
        pending_ho = db.scalar(
            select(HandoverRecord.id).where(HandoverRecord.machine_id == m.id, HandoverRecord.status == "pending")
        )
        result.append(
            {
                "id": m.id,
                "code": m.code,
                "name": m.name,
                "machine_type": m.machine_type,
                "qr_token": m.qr_token,
                "line_id": line.id,
                "line_name": line.name,
                "factory_id": fac.id,
                "factory_name": fac.name,
                "region_id": reg.id,
                "region_name": reg.name,
                "assigned_shift": shift_by_machine.get(m.id) or (shift_ctx.current_shift.shift_name if shift_ctx.current_shift else None),
                "state": _to_state_dto(m.state).model_dump(mode="json") if m.state else None,
                "health_score": health["score"],
                "health_category": health["category"],
                "has_pending_handover": bool(pending_ho),
            }
        )
    return {"user": {"id": user.id, "name": user.name, "role": user.role}, "machines": result}


@router.get("/my-reports")
def get_my_reports(user: UserAccount = Depends(require_current_user), db: Session = Depends(get_db)):
    """Return reports owned by the operator or within supervisory organizational scope."""
    permitted = get_permitted_machine_ids(db, user)
    role = normalize_role(user.role)

    prod_stmt = select(ProductionEntry).order_by(desc(ProductionEntry.recorded_at)).limit(40)
    abn_stmt = select(Abnormality).order_by(desc(Abnormality.created_at)).limit(40)
    safety_stmt = select(SafetyChecklist).order_by(desc(SafetyChecklist.submitted_at)).limit(40)
    qual_stmt = select(QualityInspection).order_by(desc(QualityInspection.inspected_at)).limit(40)
    dt_stmt = select(DowntimeEvent).order_by(desc(DowntimeEvent.started_at)).limit(40)
    ho_stmt = select(HandoverRecord).order_by(desc(HandoverRecord.created_at)).limit(40)

    if role in ("operator", "maintenance_engineer"):
        if not permitted:
            return {"production_entries": [], "abnormalities": [], "safety_checklists": [], "quality_inspections": [], "downtime_events": [], "handovers": []}
        prod_stmt = prod_stmt.where(ProductionEntry.machine_id.in_(permitted), ProductionEntry.operator_id == user.id)
        abn_stmt = abn_stmt.where(Abnormality.machine_id.in_(permitted))
        safety_stmt = safety_stmt.where(SafetyChecklist.machine_id.in_(permitted))
        qual_stmt = qual_stmt.where(QualityInspection.machine_id.in_(permitted))
        dt_stmt = dt_stmt.where(DowntimeEvent.machine_id.in_(permitted))
        ho_stmt = ho_stmt.where(HandoverRecord.machine_id.in_(permitted))
    elif permitted is not None:
        if not permitted:
            return {"production_entries": [], "abnormalities": [], "safety_checklists": [], "quality_inspections": [], "downtime_events": [], "handovers": []}
        prod_stmt = prod_stmt.where(ProductionEntry.machine_id.in_(permitted))
        abn_stmt = abn_stmt.where(Abnormality.machine_id.in_(permitted))
        safety_stmt = safety_stmt.where(SafetyChecklist.machine_id.in_(permitted))
        qual_stmt = qual_stmt.where(QualityInspection.machine_id.in_(permitted))
        dt_stmt = dt_stmt.where(DowntimeEvent.machine_id.in_(permitted))
        ho_stmt = ho_stmt.where(HandoverRecord.machine_id.in_(permitted))

    return {
        "production_entries": [
            {
                "id": p.id,
                "machine_id": p.machine_id,
                "shift_name": p.shift_name,
                "units_produced": p.units_produced,
                "target_units": p.target_units,
                "reject_units": p.reject_units,
                "good_units": max(0, p.units_produced - p.reject_units),
                "operator_name": p.operator_name,
                "recorded_at": p.recorded_at,
            }
            for p in db.scalars(prod_stmt)
        ],
        "abnormalities": [
            {"id": a.id, "code": a.code, "machine_id": a.machine_id, "title": a.title, "severity": a.severity, "status": a.status, "reported_by_name": a.reported_by_name, "created_at": a.created_at}
            for a in db.scalars(abn_stmt)
        ],
        "safety_checklists": [SafetyChecklistDTO.model_validate(s).model_dump(mode="json") for s in db.scalars(safety_stmt)],
        "quality_inspections": [QualityInspectionDTO.model_validate(q).model_dump(mode="json") for q in db.scalars(qual_stmt)],
        "downtime_events": [DowntimeEventDTO.model_validate(d).model_dump(mode="json") for d in db.scalars(dt_stmt)],
        "handovers": [
            {"id": h.id, "machine_id": h.machine_id, "previous_shift_name": h.previous_shift_name, "incoming_shift_name": h.incoming_shift_name, "status": h.status, "outgoing_operator": h.outgoing_operator, "acknowledged_by_name": h.acknowledged_by_name, "created_at": h.created_at}
            for h in db.scalars(ho_stmt)
        ],
    }


# -----------------------------------------------------------------------------
# 2. Downtime & Loss Analysis
# -----------------------------------------------------------------------------
@router.get("/downtime", response_model=list[DowntimeEventDTO])
def list_downtime_events(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    status: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    permitted = get_permitted_machine_ids(db, user)
    stmt = select(DowntimeEvent).order_by(desc(DowntimeEvent.started_at)).limit(80)
    if permitted is not None:
        if not permitted:
            return []
        stmt = stmt.where(DowntimeEvent.machine_id.in_(permitted))
    if machine_id:
        assert_machine_access(db, user, machine_id)
        stmt = stmt.where(DowntimeEvent.machine_id == machine_id)
    if factory_id:
        assert_factory_access(db, user, factory_id)
        stmt = stmt.where(DowntimeEvent.factory_id == factory_id)
    if status:
        stmt = stmt.where(DowntimeEvent.status == status)
    return [DowntimeEventDTO.model_validate(d) for d in db.scalars(stmt)]


@router.post("/downtime", response_model=DowntimeEventDTO, status_code=201)
async def create_downtime_event(
    payload: DowntimeCreateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_ctx(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift"

    started = payload.started_at or datetime.now(timezone.utc)
    ended = payload.ended_at
    if payload.duration_minutes is not None:
        dur = round(payload.duration_minutes, 2)
    elif ended is not None:
        dur = round(max(0.0, (ended - started).total_seconds() / 60.0), 2)
    else:
        dur = 0.0

    is_closed = ended is not None or (payload.duration_minutes is not None and payload.duration_minutes > 0)
    dt_ev = DowntimeEvent(
        machine_id=machine.id,
        line_id=line.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        shift_name=shift_name,
        category=payload.category,
        reason_category=payload.reason_category,
        reason_detail=payload.reason_detail.strip(),
        started_at=started,
        ended_at=ended,
        duration_minutes=dur,
        status="closed" if is_closed else "open",
        reported_by_id=user.id,
        reported_by_name=user.name,
        closed_by_id=user.id if is_closed else None,
        closed_by_name=user.name if is_closed else None,
    )
    db.add(dt_ev)
    db.flush()

    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=machine.id,
                status="Stopped" if not is_closed else None,
                downtime_delta_min=dur,
                data_source="operator_entry",
                event_type="downtime_logged",
                event_message=f"{payload.category.title()} downtime ({payload.reason_category}): {payload.reason_detail} ({dur} min)",
            )
        ],
    )
    record_audit_event(
        db,
        action="downtime_logged",
        entity_type="downtime",
        entity_id=str(dt_ev.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Logged {payload.category} downtime on {machine.code} ({payload.reason_category}, {dur} min).",
        user=user,
    )
    db.commit()
    db.refresh(dt_ev)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return DowntimeEventDTO.model_validate(dt_ev)


@router.patch("/downtime/{dt_id}", response_model=DowntimeEventDTO)
async def update_downtime_event(
    dt_id: int,
    payload: DowntimeUpdateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    dt_ev = db.get(DowntimeEvent, dt_id)
    if not dt_ev:
        raise HTTPException(status_code=404, detail="Downtime record not found.")
    assert_machine_access(db, user, dt_ev.machine_id)

    prev_dur = dt_ev.duration_minutes
    if payload.reason_category is not None:
        dt_ev.reason_category = payload.reason_category
    if payload.reason_detail is not None:
        dt_ev.reason_detail = payload.reason_detail.strip()
    if payload.status == "closed":
        dt_ev.status = "closed"
        dt_ev.ended_at = payload.ended_at or datetime.now(timezone.utc)
        dt_ev.closed_by_id = user.id
        dt_ev.closed_by_name = user.name
        if payload.duration_minutes is not None:
            dt_ev.duration_minutes = round(payload.duration_minutes, 2)
        else:
            st_at = dt_ev.started_at.replace(tzinfo=timezone.utc) if dt_ev.started_at.tzinfo is None else dt_ev.started_at
            en_at = dt_ev.ended_at.replace(tzinfo=timezone.utc) if dt_ev.ended_at.tzinfo is None else dt_ev.ended_at
            dt_ev.duration_minutes = round(max(1.0, (en_at - st_at).total_seconds() / 60.0), 2)
    elif payload.duration_minutes is not None:
        dt_ev.duration_minutes = round(payload.duration_minutes, 2)

    delta_min = max(0.0, dt_ev.duration_minutes - prev_dur)
    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=dt_ev.machine_id,
                status="Running" if dt_ev.status == "closed" else None,
                downtime_delta_min=delta_min,
                data_source="operator_entry",
                event_type="downtime_closed" if dt_ev.status == "closed" else None,
                event_message=f"Downtime #{dt_ev.id} closed ({dt_ev.duration_minutes} min)." if dt_ev.status == "closed" else None,
            )
        ],
    )
    record_audit_event(
        db,
        action="downtime_updated",
        entity_type="downtime",
        entity_id=str(dt_ev.id),
        machine_id=dt_ev.machine_id,
        factory_id=dt_ev.factory_id,
        details=f"Updated downtime #{dt_ev.id} status={dt_ev.status}, duration={dt_ev.duration_minutes} min.",
        user=user,
    )
    db.commit()
    db.refresh(dt_ev)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return DowntimeEventDTO.model_validate(dt_ev)


# -----------------------------------------------------------------------------
# 3. Digital Safety Checklist
# -----------------------------------------------------------------------------
@router.get("/safety-checklists", response_model=list[SafetyChecklistDTO])
def list_safety_checklists(
    machine_id: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    permitted = get_permitted_machine_ids(db, user)
    stmt = select(SafetyChecklist).order_by(desc(SafetyChecklist.submitted_at)).limit(50)
    if permitted is not None:
        if not permitted:
            return []
        stmt = stmt.where(SafetyChecklist.machine_id.in_(permitted))
    if machine_id:
        assert_machine_access(db, user, machine_id)
        stmt = stmt.where(SafetyChecklist.machine_id == machine_id)
    return [SafetyChecklistDTO.model_validate(s) for s in db.scalars(stmt)]


@router.post("/safety-checklists", response_model=SafetyChecklistDTO, status_code=201)
async def submit_safety_checklist(
    payload: SafetyChecklistCreateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_ctx(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = payload.shift_name or (shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift")

    failed_critical = [it for it in payload.items if it.critical and it.response == "fail"]
    has_critical_fail = len(failed_critical) > 0
    overall = "critical_fail" if has_critical_fail else ("passed" if payload.items else "incomplete")

    escalated_abn_id: Optional[int] = None
    updates = []
    if has_critical_fail:
        abn_code = f"SAF-{datetime.now(timezone.utc).strftime('%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        fail_labels = ", ".join(it.label for it in failed_critical)
        abn = Abnormality(
            code=abn_code,
            machine_id=machine.id,
            factory_id=factory.id,
            region_id=factory.region_id,
            shift_name=shift_name,
            title=f"Critical Safety Checklist Failure: {fail_labels[:140]}",
            description=f"Start-of-shift safety check failed critical item(s): {fail_labels}. Operator remarks: {payload.operator_remarks or 'None'}",
            severity="critical",
            status="open",
            fault_code="SAFETY-CRIT",
            reported_by_id=user.id,
            reported_by_name=user.name,
        )
        db.add(abn)
        db.flush()
        escalated_abn_id = abn.id
        updates = ingest_telemetry_items(
            db,
            [
                TelemetryIngestItem(
                    machine_id=machine.id,
                    status="Fault",
                    fault_code="SAFETY-CRIT",
                    fault_message=f"Critical safety inspection failed: {fail_labels}",
                    data_source="operator_entry",
                    event_type="safety_critical_fail",
                    event_message=f"[{abn_code}] Critical safety check failed by {user.name}: {fail_labels}",
                )
            ],
        )

    chk = SafetyChecklist(
        machine_id=machine.id,
        factory_id=factory.id,
        shift_name=shift_name,
        items_json=[it.model_dump() for it in payload.items],
        overall_status=overall,
        has_critical_failure=has_critical_fail,
        operator_remarks=payload.operator_remarks,
        escalated_abnormality_id=escalated_abn_id,
        submitted_by_id=user.id,
        submitted_by_name=user.name,
    )
    db.add(chk)
    db.flush()
    record_audit_event(
        db,
        action="safety_checklist_submitted",
        entity_type="safety_checklist",
        entity_id=str(chk.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Safety checklist #{chk.id} submitted by {user.name} ({overall}, critical_fail={has_critical_fail}).",
        user=user,
    )
    db.commit()
    db.refresh(chk)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return SafetyChecklistDTO.model_validate(chk)


@router.patch("/safety-checklists/{chk_id}/review", response_model=SafetyChecklistDTO)
def review_safety_checklist(
    chk_id: int,
    payload: SafetyChecklistReviewRequest,
    user: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    chk = db.get(SafetyChecklist, chk_id)
    if not chk:
        raise HTTPException(status_code=404, detail="Safety checklist not found.")
    assert_machine_access(db, user, chk.machine_id)
    chk.supervisor_review_status = payload.supervisor_review_status
    chk.supervisor_notes = payload.supervisor_notes
    chk.reviewed_by_id = user.id
    chk.reviewed_by_name = user.name
    chk.reviewed_at = datetime.now(timezone.utc)
    record_audit_event(
        db,
        action="safety_checklist_reviewed",
        entity_type="safety_checklist",
        entity_id=str(chk.id),
        machine_id=chk.machine_id,
        factory_id=chk.factory_id,
        details=f"Supervisor {user.name} marked safety checklist #{chk.id} as {payload.supervisor_review_status}.",
        user=user,
    )
    db.commit()
    db.refresh(chk)
    return SafetyChecklistDTO.model_validate(chk)


# -----------------------------------------------------------------------------
# 4. Preventive Maintenance Planner
# -----------------------------------------------------------------------------
@router.get("/maintenance-schedules", response_model=list[MaintenanceScheduleDTO])
def list_maintenance_schedules(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    overdue_only: bool = False,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    permitted = get_permitted_machine_ids(db, user)
    stmt = select(MaintenanceSchedule).order_by(MaintenanceSchedule.due_date.asc())
    if permitted is not None:
        if not permitted:
            return []
        stmt = stmt.where(MaintenanceSchedule.machine_id.in_(permitted))
    if machine_id:
        assert_machine_access(db, user, machine_id)
        stmt = stmt.where(MaintenanceSchedule.machine_id == machine_id)
    if factory_id:
        assert_factory_access(db, user, factory_id)
        stmt = stmt.where(MaintenanceSchedule.factory_id == factory_id)
    dtos = [_schedule_to_dto(db, s) for s in db.scalars(stmt)]
    if overdue_only:
        dtos = [d for d in dtos if d.is_overdue]
    return dtos


@router.post("/maintenance-schedules", response_model=MaintenanceScheduleDTO, status_code=201)
def create_maintenance_schedule(
    payload: MaintenanceScheduleCreateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "maintenance_engineer")),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, _, factory = _load_machine_ctx(db, payload.machine_id)

    eng_name: Optional[str] = None
    if payload.assigned_engineer_id:
        eng = db.get(UserAccount, payload.assigned_engineer_id)
        if eng:
            eng_name = eng.name

    sched = MaintenanceSchedule(
        machine_id=machine.id,
        factory_id=factory.id,
        title=payload.title.strip(),
        maintenance_type=payload.maintenance_type,
        frequency_days=payload.frequency_days,
        due_date=payload.due_date,
        next_service_date=payload.due_date + timedelta(days=payload.frequency_days),
        assigned_engineer_id=payload.assigned_engineer_id,
        assigned_engineer_name=eng_name,
        status="scheduled",
        created_by_id=user.id,
    )
    db.add(sched)
    db.flush()
    record_audit_event(
        db,
        action="maintenance_scheduled",
        entity_type="maintenance_schedule",
        entity_id=str(sched.id),
        machine_id=machine.id,
        factory_id=factory.id,
        details=f"Scheduled {payload.maintenance_type} PM '{payload.title}' every {payload.frequency_days}d.",
        user=user,
    )
    db.commit()
    db.refresh(sched)
    return _schedule_to_dto(db, sched)


@router.patch("/maintenance-schedules/{sched_id}", response_model=MaintenanceScheduleDTO)
async def update_maintenance_schedule(
    sched_id: int,
    payload: MaintenanceScheduleUpdateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "maintenance_engineer")),
    db: Session = Depends(get_db),
):
    sched = db.get(MaintenanceSchedule, sched_id)
    if not sched:
        raise HTTPException(status_code=404, detail="Maintenance schedule not found.")
    assert_machine_access(db, user, sched.machine_id)
    machine, _, factory = _load_machine_ctx(db, sched.machine_id)

    if payload.due_date is not None:
        sched.due_date = payload.due_date
        sched.next_service_date = payload.due_date + timedelta(days=sched.frequency_days)
    if payload.assigned_engineer_id is not None:
        eng = db.get(UserAccount, payload.assigned_engineer_id)
        if eng:
            sched.assigned_engineer_id = eng.id
            sched.assigned_engineer_name = eng.name

    updates = []
    if payload.status is not None:
        sched.status = payload.status
        if payload.status == "in_progress":
            rec = MaintenanceRecord(
                machine_id=sched.machine_id,
                factory_id=sched.factory_id,
                maintenance_type=sched.maintenance_type,
                status="in_progress",
                summary=sched.title,
                inspection_notes=payload.inspection_notes,
                parts_replaced=payload.parts_replaced,
                engineer_id=user.id,
                engineer_name=user.name,
            )
            db.add(rec)
            db.flush()
            sched.linked_record_id = rec.id
            updates = ingest_telemetry_items(
                db,
                [TelemetryIngestItem(machine_id=sched.machine_id, status="Maintenance", data_source="maintenance_workflow", event_type="pm_started", event_message=f"PM started: {sched.title}")],
            )
        elif payload.status == "completed":
            now = datetime.now(timezone.utc)
            sched.last_completed_at = now
            sched.next_service_date = now + timedelta(days=sched.frequency_days)
            if sched.linked_record_id:
                rec = db.get(MaintenanceRecord, sched.linked_record_id)
                if rec:
                    rec.status = "completed"
                    rec.completed_at = now
                    if payload.inspection_notes:
                        rec.inspection_notes = payload.inspection_notes
                    if payload.parts_replaced:
                        rec.parts_replaced = payload.parts_replaced
            else:
                rec = MaintenanceRecord(
                    machine_id=sched.machine_id,
                    factory_id=sched.factory_id,
                    maintenance_type=sched.maintenance_type,
                    status="completed",
                    summary=sched.title,
                    inspection_notes=payload.inspection_notes or "Completed via PM Planner",
                    parts_replaced=payload.parts_replaced,
                    engineer_id=user.id,
                    engineer_name=user.name,
                    completed_at=now,
                )
                db.add(rec)
                db.flush()
                sched.linked_record_id = rec.id
            if machine.specification:
                machine.specification.last_maintenance_date = now.strftime("%Y-%m-%d")
            updates = ingest_telemetry_items(
                db,
                [TelemetryIngestItem(machine_id=sched.machine_id, status="Running", data_source="maintenance_workflow", event_type="pm_completed", event_message=f"PM completed: {sched.title}")],
            )

    record_audit_event(
        db,
        action="maintenance_schedule_updated",
        entity_type="maintenance_schedule",
        entity_id=str(sched.id),
        machine_id=sched.machine_id,
        factory_id=sched.factory_id,
        details=f"PM schedule #{sched.id} ({sched.title}) updated to status={sched.status}.",
        user=user,
    )
    db.commit()
    db.refresh(sched)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return _schedule_to_dto(db, sched)


# -----------------------------------------------------------------------------
# 5. Quality & Defect Management
# -----------------------------------------------------------------------------
@router.get("/quality", response_model=list[QualityInspectionDTO])
def list_quality_inspections(
    machine_id: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    permitted = get_permitted_machine_ids(db, user)
    stmt = select(QualityInspection).order_by(desc(QualityInspection.inspected_at)).limit(60)
    if permitted is not None:
        if not permitted:
            return []
        stmt = stmt.where(QualityInspection.machine_id.in_(permitted))
    if machine_id:
        assert_machine_access(db, user, machine_id)
        stmt = stmt.where(QualityInspection.machine_id == machine_id)
    return [QualityInspectionDTO.model_validate(q) for q in db.scalars(stmt)]


@router.post("/quality", response_model=QualityInspectionDTO, status_code=201)
async def create_quality_inspection(
    payload: QualityInspectionCreateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "operator")),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, _, factory = _load_machine_ctx(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = payload.shift_name or (shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift")

    qi = QualityInspection(
        machine_id=machine.id,
        factory_id=factory.id,
        shift_name=shift_name,
        production_entry_id=payload.production_entry_id,
        inspected_qty=payload.inspected_qty,
        rejected_qty=payload.rejected_qty,
        reworked_qty=payload.reworked_qty,
        defect_category=payload.defect_category,
        remarks=payload.remarks,
        inspector_id=user.id,
        inspector_name=user.name,
    )
    db.add(qi)
    db.flush()

    if machine.state:
        good_q = max(0, payload.inspected_qty - payload.rejected_qty)
        machine.state.quality_pct = round((good_q / max(payload.inspected_qty, 1)) * 100.0, 1)

    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=machine.id,
                data_source="operator_entry",
                event_type="quality_inspected",
                event_message=f"Quality check ({payload.defect_category}): {payload.inspected_qty} inspected, {payload.rejected_qty} rejected, {payload.reworked_qty} reworked.",
            )
        ],
    )
    record_audit_event(
        db,
        action="quality_inspection_logged",
        entity_type="quality_inspection",
        entity_id=str(qi.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Logged quality check on {machine.code}: {payload.inspected_qty} inspected, {payload.rejected_qty} rejected ({payload.defect_category}).",
        user=user,
    )
    db.commit()
    db.refresh(qi)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return QualityInspectionDTO.model_validate(qi)


# -----------------------------------------------------------------------------
# 6, 7, 8, 9, 10: Health, Energy, QR Passport, Shift Roster & Analytics
# -----------------------------------------------------------------------------
@router.get("/machines/{machine_id}/health")
def get_machine_health(
    machine_id: str,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, machine_id)
    return compute_machine_health(db, machine_id)


@router.get("/machines/{machine_id}/energy")
def get_machine_energy(
    machine_id: str,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, machine_id)
    return compute_machine_energy(db, machine_id)


@router.get("/passport/{qr_or_machine_id}")
def get_qr_machine_passport(
    qr_or_machine_id: str,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    """Unified QR Machine Passport enforcing strict operator machine access."""
    machine = db.scalar(
        select(Machine).where(
            (Machine.qr_token == qr_or_machine_id) | (Machine.id == qr_or_machine_id)
        )
    )
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine or QR token '{qr_or_machine_id}' not found.")
    assert_machine_access(db, user, machine.id)

    machine, line, factory = _load_machine_ctx(db, machine.id)
    region = factory.region
    abns = list(db.scalars(select(Abnormality).where(Abnormality.machine_id == machine.id).order_by(desc(Abnormality.created_at)).limit(5)))
    maint = list(db.scalars(select(MaintenanceRecord).where(MaintenanceRecord.machine_id == machine.id).order_by(desc(MaintenanceRecord.started_at)).limit(5)))
    prod = list(db.scalars(select(ProductionEntry).where(ProductionEntry.machine_id == machine.id).order_by(desc(ProductionEntry.recorded_at)).limit(5)))
    ho = db.scalar(select(HandoverRecord).where(HandoverRecord.machine_id == machine.id).order_by(desc(HandoverRecord.created_at)).limit(1))
    safety = db.scalar(select(SafetyChecklist).where(SafetyChecklist.machine_id == machine.id).order_by(desc(SafetyChecklist.submitted_at)).limit(1))
    health = compute_machine_health(db, machine.id)
    energy = compute_machine_energy(db, machine.id)

    total_prod = sum(p.units_produced for p in prod)
    total_rej = sum(p.reject_units for p in prod)
    return {
        "machine": {
            "id": machine.id,
            "code": machine.code,
            "name": machine.name,
            "machine_type": machine.machine_type,
            "qr_token": machine.qr_token,
            "line_id": line.id,
            "line_name": line.name,
            "factory_id": factory.id,
            "factory_name": factory.name,
            "region_id": region.id,
            "region_name": region.name,
        },
        "specification": machine.specification.__dict__ if machine.specification else None,
        "state": _to_state_dto(machine.state).model_dump(mode="json") if machine.state else None,
        "health": health,
        "energy": energy,
        "recent_abnormalities": [{"id": a.id, "code": a.code, "title": a.title, "severity": a.severity, "status": a.status, "created_at": a.created_at} for a in abns],
        "maintenance_history": [{"id": m.id, "type": m.maintenance_type, "summary": m.summary, "status": m.status, "engineer_name": m.engineer_name, "started_at": m.started_at} for m in maint],
        "production_summary": {"recent_entries": len(prod), "total_units": total_prod, "total_rejects": total_rej, "good_units": max(0, total_prod - total_rej)},
        "current_handover": {"id": ho.id, "status": ho.status, "previous_shift": ho.previous_shift_name, "incoming_shift": ho.incoming_shift_name, "outgoing_operator": ho.outgoing_operator} if ho else None,
        "safety_checklist_status": SafetyChecklistDTO.model_validate(safety).model_dump(mode="json") if safety else None,
    }


@router.get("/shift-roster")
def get_shift_roster(
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    """Smart shift planning roster, operator assignments, and pending handover summary."""
    permitted_machines = get_permitted_machine_ids(db, user)
    if region_id:
        assert_region_access(db, user, region_id)
    if factory_id:
        assert_factory_access(db, user, factory_id)

    stmt = select(OperatorAssignment).where(OperatorAssignment.is_active.is_(True)).order_by(desc(OperatorAssignment.created_at))
    if permitted_machines is not None:
        if not permitted_machines:
            assignments = []
        else:
            assignments = [a for a in db.scalars(stmt) if a.machine_id in permitted_machines or a.user_id == user.id]
    else:
        assignments = list(db.scalars(stmt))

    ho_stmt = select(HandoverRecord).where(HandoverRecord.status == "pending").order_by(desc(HandoverRecord.created_at))
    if permitted_machines is not None:
        if not permitted_machines:
            pending_handovers = []
        else:
            pending_handovers = list(db.scalars(ho_stmt.where(HandoverRecord.machine_id.in_(permitted_machines))))
    else:
        pending_handovers = list(db.scalars(ho_stmt))

    regions = list(db.scalars(select(Region)))
    shift_contexts = []
    for r in regions:
        if region_id and r.id != region_id:
            continue
        ctx = resolve_shift_context(db, r.id, factory_id)
        shift_contexts.append({"region_id": r.id, "region_name": r.name, "context": ctx.model_dump(mode="json")})

    return {
        "assignments": [_assignment_to_dto(db, a).model_dump(mode="json") for a in assignments],
        "pending_handovers": [
            {
                "id": h.id,
                "machine_id": h.machine_id,
                "factory_id": h.factory_id,
                "previous_shift_name": h.previous_shift_name,
                "incoming_shift_name": h.incoming_shift_name,
                "outgoing_operator": h.outgoing_operator,
                "incoming_operator": h.incoming_operator,
                "pending_abnormalities_count": h.pending_abnormalities_count,
                "created_at": h.created_at,
            }
            for h in pending_handovers
        ],
        "regional_shifts": shift_contexts,
    }


@router.get("/analytics")
def get_factory_analytics(
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    if region_id:
        assert_region_access(db, user, region_id)
    if factory_id:
        assert_factory_access(db, user, factory_id)
    if machine_id:
        assert_machine_access(db, user, machine_id)

    permitted = get_permitted_machine_ids(db, user)
    return build_factory_performance_analytics(
        db,
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
        shift_name=shift_name,
        start_date=start_date,
        end_date=end_date,
        permitted_machine_ids=permitted,
    )


# -----------------------------------------------------------------------------
# 8. Individual Operator & Personnel Directory / Profile Endpoints (RBAC-Scoped)
# -----------------------------------------------------------------------------
def _resolve_active_assignments_for_users(db: Session) -> tuple[dict[str, Factory], dict[str, Region], dict[str, ProductionLine], dict[str, Machine]]:
    factories = {f.id: f for f in db.scalars(select(Factory))}
    regions = {r.id: r for r in db.scalars(select(Region))}
    lines = {l.id: l for l in db.scalars(select(ProductionLine))}
    machines = {
        m.id: m
        for m in db.scalars(select(Machine).options(selectinload(Machine.state)))
    }
    return factories, regions, lines, machines


def _can_view_personnel(
    db: Session,
    actor: UserAccount,
    target: UserAccount,
    target_assignments: list[OperatorAssignment],
    factories: dict[str, Factory],
) -> bool:
    actor_role = normalize_role(actor.role)
    target_role = normalize_role(target.role)
    if actor_role == "company_admin":
        return True
    if actor.id == target.id:
        return True
    if actor_role in ("operator", "maintenance_engineer"):
        return False
    if actor_role == "regional_manager":
        if not actor.assigned_region_id or target_role == "company_admin":
            return False
        if target.assigned_region_id == actor.assigned_region_id:
            return True
        return any(
            (factories.get(a.factory_id) is not None and factories[a.factory_id].region_id == actor.assigned_region_id)
            for a in target_assignments
            if a.is_active and a.factory_id
        )
    if actor_role == "factory_supervisor":
        if not actor.assigned_factory_id or target_role not in ("operator", "maintenance_engineer", "factory_supervisor"):
            return False
        if target.assigned_factory_id == actor.assigned_factory_id:
            return True
        return any(
            a.factory_id == actor.assigned_factory_id
            for a in target_assignments
            if a.is_active and a.factory_id
        )
    return False


def _assignment_scope_machines(
    a: OperatorAssignment,
    machines_by_id: dict[str, Machine],
    lines_by_id: dict[str, ProductionLine],
) -> list[Machine]:
    if a.machine_id and a.machine_id in machines_by_id:
        return [machines_by_id[a.machine_id]]
    if a.line_id:
        return [m for m in machines_by_id.values() if m.line_id == a.line_id]
    if a.factory_id:
        return [
            m
            for m in machines_by_id.values()
            if lines_by_id.get(m.line_id) and lines_by_id[m.line_id].factory_id == a.factory_id
        ]
    return []


@router.get("/personnel")
def list_personnel_directory(
    q: str = Query(default=""),
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    role: Optional[str] = None,
    actor: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    if region_id:
        assert_region_access(db, actor, region_id)
    if factory_id:
        assert_factory_access(db, actor, factory_id)
    if machine_id:
        assert_machine_access(db, actor, machine_id)

    factories, regions, lines, machines_by_id = _resolve_active_assignments_for_users(db)
    permitted = get_permitted_machine_ids(db, actor)

    stmt = select(UserAccount).order_by(UserAccount.name.asc())
    if role:
        stmt = stmt.where(UserAccount.role == normalize_role(role))
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                UserAccount.name.ilike(like),
                UserAccount.employee_id.ilike(like),
                UserAccount.email.ilike(like),
            )
        )
    users = list(db.scalars(stmt))

    all_assignments = list(db.scalars(select(OperatorAssignment).order_by(desc(OperatorAssignment.created_at))))
    assignments_by_user: dict[int, list[OperatorAssignment]] = {}
    for a in all_assignments:
        assignments_by_user.setdefault(a.user_id, []).append(a)

    items = []
    for u in users:
        u_assigns = assignments_by_user.get(u.id, [])
        if not _can_view_personnel(db, actor, u, u_assigns, factories):
            continue

        active_assigns = [a for a in u_assigns if a.is_active]
        u_machine_map: dict[str, dict] = {}
        u_line_map: dict[str, dict] = {}
        u_factory_ids: set[str] = set()
        u_region_ids: set[str] = set()

        if u.assigned_factory_id and u.assigned_factory_id in factories:
            u_factory_ids.add(u.assigned_factory_id)
            u_region_ids.add(factories[u.assigned_factory_id].region_id)
        if u.assigned_region_id and u.assigned_region_id in regions:
            u_region_ids.add(u.assigned_region_id)

        for a in active_assigns:
            if a.factory_id and a.factory_id in factories:
                u_factory_ids.add(a.factory_id)
                u_region_ids.add(factories[a.factory_id].region_id)
            if a.line_id and a.line_id in lines:
                ln = lines[a.line_id]
                u_line_map[ln.id] = {"id": ln.id, "name": ln.name}
            for m in _assignment_scope_machines(a, machines_by_id, lines):
                ln = lines.get(m.line_id)
                fac = factories.get(ln.factory_id) if ln else None
                if ln:
                    u_line_map[ln.id] = {"id": ln.id, "name": ln.name}
                if fac:
                    u_factory_ids.add(fac.id)
                    u_region_ids.add(fac.region_id)
                if permitted is None or m.id in permitted:
                    u_machine_map[m.id] = {
                        "id": m.id,
                        "code": m.code,
                        "name": m.name,
                        "status": m.state.status if m.state else "Unknown",
                        "shift_name": a.shift_name,
                    }

        if region_id and region_id not in u_region_ids:
            continue
        if factory_id and factory_id not in u_factory_ids:
            continue
        if machine_id and machine_id not in u_machine_map:
            continue

        primary_fac_id = u.assigned_factory_id or (next(iter(u_factory_ids), None))
        primary_reg_id = u.assigned_region_id or (factories[primary_fac_id].region_id if primary_fac_id and primary_fac_id in factories else next(iter(u_region_ids), None))
        current_shift = next((a.shift_name for a in active_assigns if a.shift_name), None)
        assignment_status = (
            "Inactive"
            if not u.is_active
            else ("Active" if active_assigns else "Unassigned")
        )

        items.append(
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "employee_id": u.employee_id,
                "is_active": u.is_active,
                "assigned_region_id": primary_reg_id,
                "assigned_region_name": regions[primary_reg_id].name if primary_reg_id and primary_reg_id in regions else None,
                "assigned_factory_id": primary_fac_id,
                "assigned_factory_name": factories[primary_fac_id].name if primary_fac_id and primary_fac_id in factories else None,
                "current_shift": current_shift,
                "assignment_status": assignment_status,
                "assigned_lines": list(u_line_map.values()),
                "assigned_machines": list(u_machine_map.values()),
            }
        )

    return items


@router.get("/personnel/{user_id}")
def get_personnel_profile(
    user_id: int,
    actor: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    target = db.get(UserAccount, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Personnel account not found")

    factories, regions, lines, machines_by_id = _resolve_active_assignments_for_users(db)
    user_assigns = list(
        db.scalars(
            select(OperatorAssignment)
            .where(OperatorAssignment.user_id == user_id)
            .order_by(desc(OperatorAssignment.created_at))
        )
    )
    if not _can_view_personnel(db, actor, target, user_assigns, factories):
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: {actor.role} cannot inspect individual profile for user #{user_id}.",
        )

    permitted = get_permitted_machine_ids(db, actor)
    permitted_factories = get_permitted_factory_ids(db, actor)

    active_assigns = [a for a in user_assigns if a.is_active]
    assigned_machine_map: dict[str, dict] = {}
    assigned_line_map: dict[str, dict] = {}
    enriched_assignments = []

    for a in user_assigns:
        fac = factories.get(a.factory_id) if a.factory_id else None
        if fac and permitted_factories is not None and fac.id not in permitted_factories:
            continue
        reg = regions.get(fac.region_id) if fac else None
        ln = lines.get(a.line_id) if a.line_id else None
        m = machines_by_id.get(a.machine_id) if a.machine_id else None
        if m and permitted is not None and m.id not in permitted:
            continue
        enriched_assignments.append(
            {
                "id": a.id,
                "machine_id": a.machine_id,
                "machine_code": m.code if m else None,
                "machine_name": m.name if m else None,
                "line_id": a.line_id,
                "line_name": ln.name if ln else None,
                "factory_id": a.factory_id,
                "factory_name": fac.name if fac else None,
                "region_id": reg.id if reg else None,
                "region_name": reg.name if reg else None,
                "shift_name": a.shift_name,
                "start_date": a.start_date,
                "end_date": a.end_date,
                "is_active": a.is_active,
                "assigned_by_name": a.assigned_by_name,
                "notes": a.notes,
                "created_at": a.created_at,
            }
        )
        if a.is_active:
            for scope_m in _assignment_scope_machines(a, machines_by_id, lines):
                if permitted is not None and scope_m.id not in permitted:
                    continue
                m_line = lines.get(scope_m.line_id)
                m_fac = factories.get(m_line.factory_id) if m_line else None
                m_reg = regions.get(m_fac.region_id) if m_fac else None
                if m_line:
                    assigned_line_map[m_line.id] = {
                        "id": m_line.id,
                        "name": m_line.name,
                        "code": m_line.code,
                        "factory_id": m_fac.id if m_fac else None,
                        "factory_name": m_fac.name if m_fac else None,
                    }
                assigned_machine_map[scope_m.id] = {
                    "id": scope_m.id,
                    "code": scope_m.code,
                    "name": scope_m.name,
                    "machine_type": scope_m.machine_type,
                    "status": scope_m.state.status if scope_m.state else "Unknown",
                    "oee_pct": scope_m.state.oee_pct if scope_m.state else 0.0,
                    "line_id": m_line.id if m_line else None,
                    "line_name": m_line.name if m_line else None,
                    "factory_id": m_fac.id if m_fac else None,
                    "factory_name": m_fac.name if m_fac else None,
                    "region_id": m_reg.id if m_reg else None,
                    "region_name": m_reg.name if m_reg else None,
                    "shift_name": a.shift_name,
                }

    # Resolve primary factory/region names & live shift context if needed
    primary_fac_id = target.assigned_factory_id or next(
        (a.factory_id for a in active_assigns if a.factory_id),
        None,
    )
    primary_fac = factories.get(primary_fac_id) if primary_fac_id else None
    primary_reg_id = target.assigned_region_id or (primary_fac.region_id if primary_fac else None)
    primary_reg = regions.get(primary_reg_id) if primary_reg_id else None

    explicit_shift = next((a.shift_name for a in active_assigns if a.shift_name), None)
    current_shift = explicit_shift
    if not current_shift and primary_reg_id:
        ctx = resolve_shift_context(db, primary_reg_id, primary_fac_id)
        if ctx.current_shift:
            current_shift = ctx.current_shift.shift_name

    # Recent production reports created by this operator
    prod_stmt = (
        select(ProductionEntry)
        .where(ProductionEntry.operator_id == user_id)
        .order_by(desc(ProductionEntry.recorded_at))
        .limit(15)
    )
    if permitted is not None:
        prod_stmt = prod_stmt.where(ProductionEntry.machine_id.in_(permitted or {"__none__"}))
    prod_rows = list(db.scalars(prod_stmt))

    # Recent abnormalities reported by or assigned to this user
    abn_stmt = (
        select(Abnormality)
        .where(or_(Abnormality.reported_by_id == user_id, Abnormality.assigned_to_id == user_id))
        .order_by(desc(Abnormality.created_at))
        .limit(15)
    )
    if permitted is not None:
        abn_stmt = abn_stmt.where(Abnormality.machine_id.in_(permitted or {"__none__"}))
    abn_rows = list(db.scalars(abn_stmt))

    # Recent handovers involving this user
    ho_stmt = (
        select(HandoverRecord)
        .where(
            or_(
                HandoverRecord.outgoing_operator == target.name,
                HandoverRecord.incoming_operator == target.name,
                HandoverRecord.acknowledged_by_user_id == user_id,
            )
        )
        .order_by(desc(HandoverRecord.created_at))
        .limit(15)
    )
    if permitted is not None:
        ho_stmt = ho_stmt.where(HandoverRecord.machine_id.in_(permitted or {"__none__"}))
    ho_rows = list(db.scalars(ho_stmt))

    # Recent audit events if supervisory role or viewing own profile
    actor_role = normalize_role(actor.role)
    audit_authorized = actor_role in ("company_admin", "regional_manager", "factory_supervisor") or actor.id == user_id
    audit_rows: list[AuditEvent] = []
    if audit_authorized:
        ev_stmt = (
            select(AuditEvent)
            .where(AuditEvent.actor_user_id == user_id)
            .order_by(desc(AuditEvent.created_at))
            .limit(20)
        )
        if permitted is not None:
            ev_stmt = ev_stmt.where(
                or_(
                    AuditEvent.machine_id.in_(permitted or {"__none__"}),
                    AuditEvent.machine_id.is_(None),
                )
            )
        audit_rows = list(db.scalars(ev_stmt))

    user_dto = UserDTO.model_validate(target).model_dump(mode="json")
    user_dto["assigned_region_name"] = primary_reg.name if primary_reg else None
    user_dto["assigned_factory_name"] = primary_fac.name if primary_fac else None

    return {
        "user": user_dto,
        "current_shift": current_shift,
        "assignment_status": (
            "Inactive"
            if not target.is_active
            else ("Active" if active_assigns else "Unassigned")
        ),
        "assigned_lines": list(assigned_line_map.values()),
        "assigned_machines": list(assigned_machine_map.values()),
        "assignments": enriched_assignments,
        "recent_production_reports": [
            {
                **ProductionEntryDTO.model_validate(p).model_dump(mode="json"),
                "machine_code": machines_by_id[p.machine_id].code if p.machine_id in machines_by_id else p.machine_id,
                "machine_name": machines_by_id[p.machine_id].name if p.machine_id in machines_by_id else p.machine_id,
            }
            for p in prod_rows
        ],
        "recent_abnormalities": [AbnormalityDTO.model_validate(a).model_dump(mode="json") for a in abn_rows],
        "handover_records": [HandoverRecordDTO.model_validate(h).model_dump(mode="json") for h in ho_rows],
        "audit_authorized": audit_authorized,
        "recent_audit_events": [AuditEventDTO.model_validate(ev).model_dump(mode="json") for ev in audit_rows],
    }
