"""PS-032 industrial operational endpoints: production, abnormalities, maintenance, 5S, handovers, tasks, PDF, and audit."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session, selectinload
from werkzeug.utils import secure_filename

from app.config import get_settings
from app.database import get_db
from app.models import Company, Machine, MachineEvent, ProductionLine, Region
from app.models_ps032 import (
    Abnormality,
    AuditEvent,
    Cleaning5SLog,
    DowntimeEvent,
    HandoverRecord,
    MachineTask,
    MaintenanceRecord,
    MaintenanceSchedule,
    ProductionEntry,
    QualityInspection,
    SafetyChecklist,
    TaskSubmission,
    UserAccount,
)
from app.schemas import TelemetryIngestItem
from app.schemas_ps032 import (
    AbnormalityCreateRequest,
    AbnormalityDTO,
    AbnormalityUpdateRequest,
    AuditEventDTO,
    Cleaning5SCreateRequest,
    Cleaning5SDTO,
    DowntimeEventDTO,
    HandoverAcknowledgeRequest,
    HandoverGenerateRequest,
    HandoverRecordDTO,
    MachineTaskDTO,
    MaintenanceCreateRequest,
    MaintenanceRecordDTO,
    MaintenanceScheduleDTO,
    MaintenanceUpdateRequest,
    ProductionEntryCreateRequest,
    ProductionEntryDTO,
    QualityInspectionDTO,
    SafetyChecklistDTO,
    TaskCreateRequest,
)
from app.services.access_control import (
    assert_factory_access,
    assert_handover_ack_access,
    assert_machine_access,
    assert_region_access,
    get_permitted_machine_ids,
)
from app.services.analytics_service import compute_machine_energy, compute_machine_health
from app.services.auth_service import (
    HANDOVER_ACK_ROLES,
    SUPERVISORY_ROLES,
    get_optional_user,
    normalize_role,
    record_audit_event,
    require_current_user,
    require_roles,
)
from app.services.handover_pipeline import generate_handover_note, publish_pdf
from app.services.shift_engine import resolve_shift_context
from app.services.telemetry_service import ingest_telemetry_items
from app.services.ws_manager import ws_manager

router = APIRouter(tags=["ps032-operations"])


def _load_machine_context(db: Session, machine_id: str):
    machine = db.scalar(
        select(Machine)
        .where(Machine.id == machine_id)
        .options(
            selectinload(Machine.state),
            selectinload(Machine.production_line).selectinload(ProductionLine.factory),
        )
    )
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    line = machine.production_line
    factory = line.factory
    return machine, line, factory


# -----------------------------------------------------------------------------
# Machine Operational Workspace Bundle
# -----------------------------------------------------------------------------
@router.get("/api/ps032/machines/{machine_id}/workspace")
def get_machine_workspace(
    machine_id: str,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, machine_id)
    machine, line, factory = _load_machine_context(db, machine_id)

    abnormalities = list(
        db.scalars(
            select(Abnormality)
            .where(Abnormality.machine_id == machine_id)
            .order_by(desc(Abnormality.created_at))
            .limit(20)
        )
    )
    maintenance = list(
        db.scalars(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.machine_id == machine_id)
            .order_by(desc(MaintenanceRecord.started_at))
            .limit(20)
        )
    )
    cleaning_logs = list(
        db.scalars(
            select(Cleaning5SLog)
            .where(Cleaning5SLog.machine_id == machine_id)
            .order_by(desc(Cleaning5SLog.logged_at))
            .limit(15)
        )
    )
    production_entries = list(
        db.scalars(
            select(ProductionEntry)
            .where(ProductionEntry.machine_id == machine_id)
            .order_by(desc(ProductionEntry.recorded_at))
            .limit(15)
        )
    )
    handovers = list(
        db.scalars(
            select(HandoverRecord)
            .where(HandoverRecord.machine_id == machine_id)
            .order_by(desc(HandoverRecord.created_at))
            .limit(15)
        )
    )
    tasks = list(
        db.scalars(
            select(MachineTask)
            .where(MachineTask.machine_id == machine_id)
            .options(selectinload(MachineTask.submission))
            .order_by(desc(MachineTask.created_at))
            .limit(15)
        )
    )
    downtime_events = list(
        db.scalars(
            select(DowntimeEvent)
            .where(DowntimeEvent.machine_id == machine_id)
            .order_by(desc(DowntimeEvent.started_at))
            .limit(15)
        )
    )
    safety_checklists = list(
        db.scalars(
            select(SafetyChecklist)
            .where(SafetyChecklist.machine_id == machine_id)
            .order_by(desc(SafetyChecklist.submitted_at))
            .limit(10)
        )
    )
    maint_schedules = list(
        db.scalars(
            select(MaintenanceSchedule)
            .where(MaintenanceSchedule.machine_id == machine_id)
            .order_by(MaintenanceSchedule.due_date.asc())
        )
    )
    quality_inspections = list(
        db.scalars(
            select(QualityInspection)
            .where(QualityInspection.machine_id == machine_id)
            .order_by(desc(QualityInspection.inspected_at))
            .limit(15)
        )
    )

    now = datetime.now(timezone.utc)
    sched_dtos = []
    for s in maint_schedules:
        due = s.due_date.replace(tzinfo=timezone.utc) if s.due_date.tzinfo is None else s.due_date
        dto = MaintenanceScheduleDTO.model_validate(s).model_dump(mode="json")
        dto["is_overdue"] = s.status != "completed" and due < now
        sched_dtos.append(dto)

    return {
        "machine_id": machine.id,
        "factory_id": factory.id,
        "region_id": factory.region_id,
        "abnormalities": [AbnormalityDTO.model_validate(a).model_dump(mode="json") for a in abnormalities],
        "maintenance_records": [MaintenanceRecordDTO.model_validate(m).model_dump(mode="json") for m in maintenance],
        "cleaning_logs": [Cleaning5SDTO.model_validate(c).model_dump(mode="json") for c in cleaning_logs],
        "production_entries": [ProductionEntryDTO.model_validate(p).model_dump(mode="json") for p in production_entries],
        "handovers": [HandoverRecordDTO.model_validate(h).model_dump(mode="json") for h in handovers],
        "tasks": [MachineTaskDTO.model_validate(t).model_dump(mode="json") for t in tasks],
        "downtime_events": [DowntimeEventDTO.model_validate(d).model_dump(mode="json") for d in downtime_events],
        "safety_checklists": [SafetyChecklistDTO.model_validate(sc).model_dump(mode="json") for sc in safety_checklists],
        "maintenance_schedules": sched_dtos,
        "quality_inspections": [QualityInspectionDTO.model_validate(q).model_dump(mode="json") for q in quality_inspections],
        "health": compute_machine_health(db, machine.id),
        "energy": compute_machine_energy(db, machine.id),
    }


# -----------------------------------------------------------------------------
# Production Entry
# -----------------------------------------------------------------------------
@router.get("/api/ps032/production", response_model=list[ProductionEntryDTO])
def list_production_entries(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    limit: int = Query(default=40, ge=1, le=200),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(ProductionEntry).order_by(desc(ProductionEntry.recorded_at)).limit(limit)
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(ProductionEntry.machine_id == machine_id)
    elif user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(ProductionEntry.machine_id.in_(permitted or {"__none__"}))
    if factory_id:
        if user is not None:
            assert_factory_access(db, user, factory_id)
        stmt = stmt.where(ProductionEntry.factory_id == factory_id)
    return [ProductionEntryDTO.model_validate(p) for p in db.scalars(stmt)]


@router.post("/api/ps032/production", response_model=ProductionEntryDTO, status_code=201)
async def create_production_entry(
    payload: ProductionEntryCreateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "operator")),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_context(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = payload.shift_name or (shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift")
    target = payload.target_units or (machine.state.production_target if machine.state else 120)

    entry = ProductionEntry(
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        shift_name=shift_name,
        operator_id=user.id,
        operator_name=user.name,
        units_produced=payload.units_produced,
        target_units=target,
        reject_units=payload.reject_units,
        downtime_minutes=payload.downtime_minutes,
        remarks=payload.remarks,
    )
    db.add(entry)

    if machine.state:
        good_units = max(0, payload.units_produced - payload.reject_units)
        quality = round((good_units / max(payload.units_produced, 1)) * 100.0, 1) if payload.units_produced > 0 else machine.state.quality_pct
        machine.state.quality_pct = quality
        machine.state.production_target = target
        machine.state.assigned_operator = user.name

    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=machine.id,
                production_count=payload.units_produced,
                downtime_delta_min=payload.downtime_minutes,
                data_source="operator_entry",
                event_type="production_logged",
                event_message=f"Operator {user.name} logged {payload.units_produced} units ({payload.reject_units} rejects) for {shift_name}.",
            )
        ],
    )
    record_audit_event(
        db,
        action="production_recorded",
        entity_type="production_entry",
        entity_id=str(entry.id or machine.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Logged {payload.units_produced}/{target} units on {machine.code} ({shift_name}).",
        user=user,
    )
    db.commit()
    db.refresh(entry)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return ProductionEntryDTO.model_validate(entry)


# -----------------------------------------------------------------------------
# Abnormality Management
# -----------------------------------------------------------------------------
@router.get("/api/ps032/abnormalities", response_model=list[AbnormalityDTO])
def list_abnormalities(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(Abnormality).order_by(desc(Abnormality.created_at)).limit(limit)
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(Abnormality.machine_id == machine_id)
    elif user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(Abnormality.machine_id.in_(permitted or {"__none__"}))
    if factory_id:
        if user is not None:
            assert_factory_access(db, user, factory_id)
        stmt = stmt.where(Abnormality.factory_id == factory_id)
    if status:
        stmt = stmt.where(Abnormality.status == status)
    return [AbnormalityDTO.model_validate(a) for a in db.scalars(stmt)]


@router.post("/api/ps032/abnormalities", response_model=AbnormalityDTO, status_code=201)
async def create_abnormality(
    payload: AbnormalityCreateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_context(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift"

    assignee_name: Optional[str] = None
    if payload.assigned_to_id:
        assignee = db.get(UserAccount, payload.assigned_to_id)
        if assignee:
            assignee_name = assignee.name

    code = f"ABN-{datetime.now(timezone.utc).strftime('%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    abn = Abnormality(
        code=code,
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        shift_name=shift_name,
        title=payload.title.strip(),
        description=payload.description.strip(),
        severity=payload.severity,
        status="open",
        fault_code=payload.fault_code,
        reported_by_id=user.id,
        reported_by_name=user.name,
        assigned_to_id=payload.assigned_to_id,
        assigned_to_name=assignee_name,
    )
    db.add(abn)
    db.flush()

    updates = []
    if payload.severity in ("high", "critical"):
        updates = ingest_telemetry_items(
            db,
            [
                TelemetryIngestItem(
                    machine_id=machine.id,
                    status="Fault",
                    fault_code=payload.fault_code or code,
                    fault_message=payload.title,
                    data_source="operator_entry",
                    event_type="abnormality_reported",
                    event_message=f"[{code}] {payload.title} reported by {user.name}",
                )
            ],
        )

    record_audit_event(
        db,
        action="abnormality_created",
        entity_type="abnormality",
        entity_id=code,
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Created abnormality {code} ({payload.severity}): {payload.title}",
        user=user,
    )
    db.commit()
    db.refresh(abn)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return AbnormalityDTO.model_validate(abn)


@router.patch("/api/ps032/abnormalities/{abn_id}", response_model=AbnormalityDTO)
async def update_abnormality(
    abn_id: int,
    payload: AbnormalityUpdateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "maintenance_engineer")),
    db: Session = Depends(get_db),
):
    abn = db.get(Abnormality, abn_id)
    if not abn:
        raise HTTPException(status_code=404, detail="Abnormality not found")
    assert_machine_access(db, user, abn.machine_id)

    if payload.assigned_to_id is not None:
        assignee = db.get(UserAccount, payload.assigned_to_id)
        if not assignee:
            raise HTTPException(status_code=404, detail="Assigned user not found")
        abn.assigned_to_id = assignee.id
        abn.assigned_to_name = assignee.name

    if payload.resolution_notes is not None:
        abn.resolution_notes = payload.resolution_notes.strip()

    updates = []
    if payload.status is not None:
        abn.status = payload.status
        if payload.status == "resolved":
            abn.resolved_at = datetime.now(timezone.utc)
            remaining_critical = db.scalar(
                select(Abnormality.id).where(
                    Abnormality.machine_id == abn.machine_id,
                    Abnormality.id != abn.id,
                    Abnormality.status != "resolved",
                    Abnormality.severity.in_(("high", "critical")),
                )
            )
            if not remaining_critical:
                updates = ingest_telemetry_items(
                    db,
                    [
                        TelemetryIngestItem(
                            machine_id=abn.machine_id,
                            status="Running",
                            data_source="operator_entry",
                            event_type="abnormality_resolved",
                            event_message=f"[{abn.code}] Resolved by {user.name}: {abn.resolution_notes or 'Cleared'}",
                        )
                    ],
                )

    record_audit_event(
        db,
        action="abnormality_updated",
        entity_type="abnormality",
        entity_id=abn.code,
        machine_id=abn.machine_id,
        factory_id=abn.factory_id,
        region_id=abn.region_id,
        details=f"Abnormality {abn.code} status={abn.status}; notes={abn.resolution_notes or '—'}",
        user=user,
    )
    db.commit()
    db.refresh(abn)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return AbnormalityDTO.model_validate(abn)


# -----------------------------------------------------------------------------
# Maintenance Workflow
# -----------------------------------------------------------------------------
@router.get("/api/ps032/maintenance", response_model=list[MaintenanceRecordDTO])
def list_maintenance(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    limit: int = Query(default=40, ge=1, le=200),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(MaintenanceRecord).order_by(desc(MaintenanceRecord.started_at)).limit(limit)
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(MaintenanceRecord.machine_id == machine_id)
    elif user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(MaintenanceRecord.machine_id.in_(permitted or {"__none__"}))
    if factory_id:
        if user is not None:
            assert_factory_access(db, user, factory_id)
        stmt = stmt.where(MaintenanceRecord.factory_id == factory_id)
    return [MaintenanceRecordDTO.model_validate(r) for r in db.scalars(stmt)]


@router.post("/api/ps032/maintenance", response_model=MaintenanceRecordDTO, status_code=201)
async def create_maintenance(
    payload: MaintenanceCreateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "maintenance_engineer")),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_context(db, payload.machine_id)
    rec = MaintenanceRecord(
        machine_id=machine.id,
        factory_id=factory.id,
        maintenance_type=payload.maintenance_type,
        status=payload.status,
        summary=payload.summary.strip(),
        inspection_notes=payload.inspection_notes,
        parts_replaced=payload.parts_replaced,
        engineer_id=user.id,
        engineer_name=user.name,
        abnormality_id=payload.abnormality_id,
        completed_at=datetime.now(timezone.utc) if payload.status == "completed" else None,
    )
    db.add(rec)
    db.flush()

    updates = []
    if payload.status == "in_progress":
        updates = ingest_telemetry_items(
            db,
            [
                TelemetryIngestItem(
                    machine_id=machine.id,
                    status="Maintenance",
                    data_source="maintenance_workflow",
                    event_type="maintenance_started",
                    event_message=f"Maintenance started by {user.name}: {payload.summary}",
                )
            ],
        )

    record_audit_event(
        db,
        action="maintenance_recorded",
        entity_type="maintenance",
        entity_id=str(rec.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"{payload.maintenance_type.title()} maintenance ({payload.status}): {payload.summary}",
        user=user,
    )
    db.commit()
    db.refresh(rec)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return MaintenanceRecordDTO.model_validate(rec)


@router.patch("/api/ps032/maintenance/{rec_id}", response_model=MaintenanceRecordDTO)
async def update_maintenance(
    rec_id: int,
    payload: MaintenanceUpdateRequest,
    user: UserAccount = Depends(require_roles("company_admin", "regional_manager", "factory_supervisor", "maintenance_engineer")),
    db: Session = Depends(get_db),
):
    rec = db.get(MaintenanceRecord, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Maintenance record not found")
    assert_machine_access(db, user, rec.machine_id)
    if payload.inspection_notes is not None:
        rec.inspection_notes = payload.inspection_notes
    if payload.parts_replaced is not None:
        rec.parts_replaced = payload.parts_replaced

    updates = []
    if payload.status is not None:
        rec.status = payload.status
        if payload.status == "completed":
            rec.completed_at = datetime.now(timezone.utc)
            updates = ingest_telemetry_items(
                db,
                [
                    TelemetryIngestItem(
                        machine_id=rec.machine_id,
                        status="Running",
                        data_source="maintenance_workflow",
                        event_type="maintenance_completed",
                        event_message=f"Maintenance #{rec.id} completed by {user.name}; machine returned to service.",
                    )
                ],
            )

    record_audit_event(
        db,
        action="maintenance_updated",
        entity_type="maintenance",
        entity_id=str(rec.id),
        machine_id=rec.machine_id,
        factory_id=rec.factory_id,
        details=f"Maintenance #{rec.id} updated to status={rec.status}.",
        user=user,
    )
    db.commit()
    db.refresh(rec)
    if updates:
        await ws_manager.broadcast("telemetry_batch", {"updates": updates})
    return MaintenanceRecordDTO.model_validate(rec)


# -----------------------------------------------------------------------------
# Cleaning & 5S Logs
# -----------------------------------------------------------------------------
@router.get("/api/ps032/cleaning", response_model=list[Cleaning5SDTO])
def list_cleaning_logs(
    machine_id: Optional[str] = None,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(Cleaning5SLog).order_by(desc(Cleaning5SLog.logged_at)).limit(40)
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(Cleaning5SLog.machine_id == machine_id)
    elif user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(Cleaning5SLog.machine_id.in_(permitted or {"__none__"}))
    return [Cleaning5SDTO.model_validate(c) for c in db.scalars(stmt)]


@router.post("/api/ps032/cleaning", response_model=Cleaning5SDTO, status_code=201)
def create_cleaning_log(
    payload: Cleaning5SCreateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, _, factory = _load_machine_context(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    shift_name = payload.shift_name or (shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Active Shift")

    log = Cleaning5SLog(
        machine_id=machine.id,
        shift_name=shift_name,
        area_cleaned=payload.area_cleaned,
        lubrication_checked=payload.lubrication_checked,
        guards_verified=payload.guards_verified,
        safety_observations=payload.safety_observations,
        logged_by_id=user.id,
        logged_by_name=user.name,
    )
    db.add(log)
    db.flush()
    record_audit_event(
        db,
        action="cleaning_5s_logged",
        entity_type="cleaning_5s",
        entity_id=str(log.id),
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"5S checklist logged for {machine.code} ({shift_name}).",
        user=user,
    )
    db.commit()
    db.refresh(log)
    return Cleaning5SDTO.model_validate(log)


# -----------------------------------------------------------------------------
# Machine-Wise Shift Handover & Acknowledgement (Core Business Function)
# -----------------------------------------------------------------------------
@router.get("/api/ps032/handovers", response_model=list[HandoverRecordDTO])
def list_handovers(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    region_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=40, ge=1, le=200),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(HandoverRecord).order_by(desc(HandoverRecord.created_at)).limit(limit)
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(HandoverRecord.machine_id == machine_id)
    elif user is not None:
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            stmt = stmt.where(HandoverRecord.machine_id.in_(permitted or {"__none__"}))
    if factory_id:
        if user is not None:
            assert_factory_access(db, user, factory_id)
        stmt = stmt.where(HandoverRecord.factory_id == factory_id)
    if region_id:
        if user is not None:
            assert_region_access(db, user, region_id)
        stmt = stmt.where(HandoverRecord.region_id == region_id)
    if status:
        stmt = stmt.where(HandoverRecord.status == status)
    return [HandoverRecordDTO.model_validate(h) for h in db.scalars(stmt)]


@router.get("/api/ps032/handovers/{handover_id}", response_model=HandoverRecordDTO)
def get_handover(
    handover_id: str,
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    ho = db.get(HandoverRecord, handover_id)
    if not ho:
        raise HTTPException(status_code=404, detail="Handover record not found")
    if user is not None:
        assert_machine_access(db, user, ho.machine_id)
    return HandoverRecordDTO.model_validate(ho)


def build_handover_industrial_context(
    db: Session,
    *,
    machine: Machine,
    line: ProductionLine,
    factory,
    ho_record: HandoverRecord | None = None,
    outgoing_operator: str | None = None,
    incoming_operator: str | None = None,
    supervisor_name: str | None = None,
    previous_shift_name: str = "Previous Shift",
    incoming_shift_name: str = "Incoming Shift",
    operator_remarks: str | None = None,
    maintenance_instructions: str | None = None,
    required_inspection: str | None = None,
    special_instructions: str | None = None,
) -> dict:
    """Gather real DB context (company, region, factory, telemetry, abnormalities, maintenance, 5S) for PDF."""
    region = db.get(Region, factory.region_id)
    company = db.get(Company, region.company_id) if region else None

    abns = list(
        db.scalars(
            select(Abnormality)
            .where(Abnormality.machine_id == machine.id)
            .order_by(desc(Abnormality.created_at))
            .limit(12)
        )
    )
    maint_list = list(
        db.scalars(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.machine_id == machine.id)
            .order_by(desc(MaintenanceRecord.started_at))
            .limit(8)
        )
    )
    latest_5s = db.scalar(
        select(Cleaning5SLog)
        .where(Cleaning5SLog.machine_id == machine.id)
        .order_by(desc(Cleaning5SLog.logged_at))
        .limit(1)
    )
    latest_prod = db.scalar(
        select(ProductionEntry)
        .where(ProductionEntry.machine_id == machine.id)
        .order_by(desc(ProductionEntry.recorded_at))
        .limit(1)
    )
    st = machine.state

    return {
        "company_name": company.name if company else "Apex Precision Manufacturing",
        "region_name": region.name if region else factory.region_id,
        "factory_name": factory.name,
        "line_name": line.name,
        "machine_id": machine.id,
        "machine_code": machine.code,
        "machine_name": machine.name,
        "machine_info": {
            "machine_condition": st.status if st else (ho_record.machine_condition if ho_record else "Unknown"),
            "handover_status": ho_record.status if ho_record else (st.handover_status if st else "pending"),
            "outgoing_operator": outgoing_operator or (ho_record.outgoing_operator if ho_record else None),
            "incoming_operator": incoming_operator or (ho_record.incoming_operator if ho_record else None),
            "supervisor_name": supervisor_name or (ho_record.supervisor_name if ho_record else None),
            "previous_shift_name": ho_record.previous_shift_name if ho_record else previous_shift_name,
            "incoming_shift_name": ho_record.incoming_shift_name if ho_record else incoming_shift_name,
            "production_completed": st.production_count if st else (ho_record.production_completed if ho_record else 0),
            "production_target": st.production_target if st else (ho_record.production_target if ho_record else 0),
            "reject_units": latest_prod.reject_units if latest_prod else 0,
            "downtime_minutes": st.downtime_min if st else (ho_record.downtime_minutes if ho_record else 0.0),
            "oee_pct": st.oee_pct if st else "—",
            "temperature_c": st.temperature_c if st else "—",
            "vibration_mm_s": st.vibration_mm_s if st else "—",
            "energy_kw": st.energy_kw if st else "—",
            "cycle_time_sec": st.cycle_time_sec if st else "—",
            "data_source": st.data_source if st else "simulation",
        },
        "abnormalities": [
            {
                "code": a.code,
                "title": a.title,
                "description": a.description,
                "severity": a.severity,
                "status": a.status,
                "assigned_to_name": a.assigned_to_name,
                "resolution_notes": a.resolution_notes,
                "created_at": a.created_at.strftime("%Y-%m-%d %H:%M UTC"),
            }
            for a in abns
        ],
        "maintenance_records": [
            {
                "maintenance_type": m.maintenance_type,
                "summary": m.summary,
                "status": m.status,
                "engineer_name": m.engineer_name,
                "parts_replaced": m.parts_replaced,
                "inspection_notes": m.inspection_notes,
            }
            for m in maint_list
        ],
        "cleaning_5s": (
            {
                "area_cleaned": latest_5s.area_cleaned,
                "lubrication_checked": latest_5s.lubrication_checked,
                "guards_verified": latest_5s.guards_verified,
                "safety_observations": latest_5s.safety_observations,
                "logged_by_name": latest_5s.logged_by_name,
                "logged_at": latest_5s.logged_at.strftime("%Y-%m-%d %H:%M UTC"),
            }
            if latest_5s
            else None
        ),
        "handover_notes": {
            "operator_remarks": operator_remarks or (ho_record.operator_remarks if ho_record else None),
            "maintenance_instructions": maintenance_instructions or (ho_record.maintenance_instructions if ho_record else None),
            "required_inspection": required_inspection or (ho_record.required_inspection if ho_record else None),
            "special_instructions": special_instructions or (ho_record.special_instructions if ho_record else None),
            "safety_observations": (
                latest_5s.safety_observations
                if latest_5s
                else (ho_record.safety_observations if ho_record else None)
            ),
        },
        "acknowledgement": (
            {
                "status": ho_record.status,
                "acknowledged_by_name": ho_record.acknowledged_by_name,
                "acknowledged_at": ho_record.acknowledged_at.strftime("%Y-%m-%d %H:%M UTC")
                if ho_record.acknowledged_at
                else None,
                "acknowledgement_remarks": ho_record.acknowledgement_remarks,
            }
            if ho_record
            else {"status": "pending"}
        ),
    }


@router.post("/api/ps032/handovers/generate", response_model=HandoverRecordDTO, status_code=201)
async def generate_machine_handover(
    payload: HandoverGenerateRequest,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    assert_machine_access(db, user, payload.machine_id)
    machine, line, factory = _load_machine_context(db, payload.machine_id)
    shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
    prev_shift = shift_ctx.current_shift.shift_name if shift_ctx.current_shift else "Current Shift"
    next_shift = shift_ctx.upcoming_shift.shift_name if shift_ctx.upcoming_shift else "Incoming Shift"
    window_label = (
        f"{shift_ctx.current_shift.start_time} - {shift_ctx.current_shift.end_time}"
        if shift_ctx.current_shift
        else "Shift Window"
    )

    abns = list(
        db.scalars(
            select(Abnormality)
            .where(Abnormality.machine_id == machine.id)
            .order_by(desc(Abnormality.created_at))
            .limit(10)
        )
    )
    maint_list = list(
        db.scalars(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.machine_id == machine.id)
            .order_by(desc(MaintenanceRecord.started_at))
            .limit(5)
        )
    )
    latest_5s = db.scalar(
        select(Cleaning5SLog).where(Cleaning5SLog.machine_id == machine.id).order_by(desc(Cleaning5SLog.logged_at)).limit(1)
    )
    tasks = list(
        db.scalars(select(MachineTask).where(MachineTask.machine_id == machine.id).order_by(desc(MachineTask.created_at)).limit(8))
    )

    # Feed grounded events into preserved 3-stage generator
    now = datetime.now(timezone.utc)
    pipeline_events = []
    for a in abns:
        pipeline_events.append(
            {
                "source": "abnormality",
                "record_id": a.code,
                "status": "critical" if a.severity == "critical" and a.status != "resolved" else a.status,
                "severity": a.severity,
                "assignee": a.assigned_to_name,
                "summary": f"{a.title} ({a.description})",
                "timestamp": a.created_at.isoformat(),
                "timestamp_utc": a.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "parsed_datetime_utc": a.created_at,
            }
        )
    for m in maint_list:
        pipeline_events.append(
            {
                "source": "maintenance",
                "record_id": f"MNT-{m.id}",
                "status": m.status,
                "assignee": m.engineer_name,
                "summary": m.summary,
                "timestamp": m.started_at.isoformat(),
                "timestamp_utc": m.started_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "parsed_datetime_utc": m.started_at,
            }
        )
    for t in tasks:
        pipeline_events.append(
            {
                "source": "task",
                "record_id": f"TSK-{t.id}",
                "status": t.status,
                "assignee": user.name,
                "summary": t.title,
                "timestamp": t.created_at.isoformat(),
                "timestamp_utc": t.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "parsed_datetime_utc": t.created_at,
            }
        )
    if latest_5s:
        pipeline_events.append(
            {
                "source": "cleaning_5s",
                "record_id": f"5S-{latest_5s.id}",
                "status": "chat",
                "summary": (
                    f"Cleaned={latest_5s.area_cleaned}, Lube={latest_5s.lubrication_checked}, "
                    f"Guards={latest_5s.guards_verified} | {latest_5s.safety_observations or 'No hazards'}"
                ),
                "timestamp": latest_5s.logged_at.isoformat(),
                "timestamp_utc": latest_5s.logged_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "parsed_datetime_utc": latest_5s.logged_at,
            }
        )

    ho_id = f"HO-{machine.code}-{now.strftime('%Y%m%d%H%M%S')}"
    grounded = generate_handover_note(
        pipeline_events,
        meta={
            "report_id": ho_id,
            "machine_label": f"{machine.code} — {machine.name}",
            "shift_start_local": shift_ctx.current_shift.start_time if shift_ctx.current_shift else "00:00",
            "shift_end_local": shift_ctx.current_shift.end_time if shift_ctx.current_shift else "23:59",
            "timezone": shift_ctx.timezone,
        },
    )

    open_abns = [a for a in abns if a.status != "resolved"]
    st = machine.state
    resolved_maint_instr = payload.maintenance_instructions or (
        maint_list[0].summary if maint_list else "Standard preventive checks"
    )
    resolved_op_remarks = payload.operator_remarks or "Submitted for incoming shift acknowledgement."
    resolved_req_insp = payload.required_inspection or "Verify tooling & safety interlocks prior to cycle start."

    grounded["industrial_context"] = build_handover_industrial_context(
        db,
        machine=machine,
        line=line,
        factory=factory,
        outgoing_operator=user.name,
        incoming_operator=payload.incoming_operator,
        supervisor_name=shift_ctx.current_shift.supervisor if shift_ctx.current_shift else None,
        previous_shift_name=prev_shift,
        incoming_shift_name=next_shift,
        operator_remarks=resolved_op_remarks,
        maintenance_instructions=resolved_maint_instr,
        required_inspection=resolved_req_insp,
        special_instructions=payload.special_instructions,
    )
    pdf_path = publish_pdf(grounded)

    ho = HandoverRecord(
        id=ho_id,
        machine_id=machine.id,
        line_id=line.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        previous_shift_name=prev_shift,
        incoming_shift_name=next_shift,
        shift_window_label=window_label,
        timezone=shift_ctx.timezone,
        outgoing_operator=user.name,
        incoming_operator=payload.incoming_operator,
        supervisor_name=shift_ctx.current_shift.supervisor if shift_ctx.current_shift else None,
        production_completed=st.production_count if st else 0,
        production_target=st.production_target if st else 0,
        machine_condition=st.status if st else "Unknown",
        downtime_minutes=st.downtime_min if st else 0.0,
        pending_abnormalities_count=len(open_abns),
        maintenance_instructions=resolved_maint_instr,
        cleaning_summary=(
            f"Area cleaned: {latest_5s.area_cleaned}, Guards verified: {latest_5s.guards_verified}"
            if latest_5s
            else "5S checklist not logged"
        ),
        safety_observations=latest_5s.safety_observations if latest_5s else "No safety hazards reported",
        operator_remarks=resolved_op_remarks,
        required_inspection=resolved_req_insp,
        special_instructions=payload.special_instructions,
        grounded_report_json=grounded,
        pdf_filename=pdf_path.name,
        status="pending",
    )
    db.add(ho)

    if st:
        st.handover_status = "pending"

    db.add(
        MachineEvent(
            machine_id=machine.id,
            factory_id=factory.id,
            region_id=factory.region_id,
            line_id=line.id,
            shift_name=prev_shift,
            event_type="handover_generated",
            severity="warning",
            previous_status=st.status if st else None,
            new_status=st.status if st else None,
            message=f"Shift handover {ho_id} generated by {user.name} ({len(open_abns)} open abnormalities).",
            data_source="ps032_handover",
        )
    )
    record_audit_event(
        db,
        action="handover_generated",
        entity_type="handover",
        entity_id=ho_id,
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Generated shift handover {ho_id} ({prev_shift} -> {next_shift}) with {len(open_abns)} open abnormalities.",
        user=user,
    )
    db.commit()
    db.refresh(ho)
    await ws_manager.broadcast("shift_transition", {"machine_id": machine.id, "handover_id": ho_id, "status": "pending"})
    return HandoverRecordDTO.model_validate(ho)


@router.post("/api/ps032/handovers/{handover_id}/acknowledge", response_model=HandoverRecordDTO)
async def acknowledge_handover(
    handover_id: str,
    payload: HandoverAcknowledgeRequest,
    user: UserAccount = Depends(require_roles(*HANDOVER_ACK_ROLES)),
    db: Session = Depends(get_db),
):
    ho = db.get(HandoverRecord, handover_id)
    if not ho:
        raise HTTPException(status_code=404, detail="Handover record not found")
    if not payload.condition_confirmed:
        raise HTTPException(status_code=400, detail="Machine condition confirmation is required to acknowledge.")
    assert_handover_ack_access(db, user, ho)

    machine, line, factory = _load_machine_context(db, ho.machine_id)
    now = datetime.now(timezone.utc)
    ho.status = "acknowledged"
    ho.incoming_operator = ho.incoming_operator or user.name
    ho.acknowledged_by_user_id = user.id
    ho.acknowledged_by_name = user.name
    ho.acknowledged_at = now
    ho.acknowledgement_remarks = payload.remarks or "Handover reviewed and machine condition confirmed."

    # Check if any other pending handovers exist for this machine
    other_pending = db.scalar(
        select(HandoverRecord.id).where(
            HandoverRecord.machine_id == ho.machine_id,
            HandoverRecord.id != ho.id,
            HandoverRecord.status == "pending",
        )
    )
    if machine.state and not other_pending:
        machine.state.handover_status = "complete"
        machine.state.assigned_operator = user.name

    db.add(
        MachineEvent(
            machine_id=machine.id,
            factory_id=factory.id,
            region_id=factory.region_id,
            line_id=line.id,
            shift_name=ho.incoming_shift_name,
            event_type="handover_acknowledged",
            severity="info",
            previous_status=machine.state.status if machine.state else None,
            new_status=machine.state.status if machine.state else None,
            message=f"Handover {ho.id} acknowledged by {user.name} ({user.role}).",
            data_source="ps032_handover",
        )
    )
    record_audit_event(
        db,
        action="handover_acknowledged",
        entity_type="handover",
        entity_id=ho.id,
        machine_id=machine.id,
        factory_id=factory.id,
        region_id=factory.region_id,
        details=f"Incoming operator {user.name} acknowledged handover {ho.id}. Remarks: {ho.acknowledgement_remarks}",
        user=user,
        metadata_json={"shift": ho.incoming_shift_name, "condition_confirmed": payload.condition_confirmed},
    )
    db.commit()
    db.refresh(ho)

    # Re-render PDF with incoming operator acknowledgement details
    if ho.grounded_report_json:
        updated_note = dict(ho.grounded_report_json)
        updated_note["industrial_context"] = build_handover_industrial_context(
            db,
            machine=machine,
            line=line,
            factory=factory,
            ho_record=ho,
        )
        ho.grounded_report_json = updated_note
        publish_pdf(updated_note, Path(get_settings().output_dir) / (ho.pdf_filename or f"{ho.id}.pdf"))
        db.commit()
        db.refresh(ho)

    await ws_manager.broadcast(
        "shift_transition",
        {"machine_id": machine.id, "handover_id": ho.id, "status": "acknowledged"},
    )
    return HandoverRecordDTO.model_validate(ho)


@router.get("/api/download/{report_id}")
def download_handover_pdf(report_id: str, inline: bool = Query(default=False)):
    safe_id = Path(report_id).name
    if not safe_id.endswith(".pdf"):
        safe_id = f"{safe_id}.pdf"
    file_path = Path(get_settings().output_dir) / safe_id
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found.")
    return FileResponse(
        path=str(file_path),
        media_type="application/pdf",
        filename=safe_id,
        content_disposition_type="inline" if inline else "attachment",
    )


# -----------------------------------------------------------------------------
# Preserved Handover-note Task & Submission Workflows (Industrialized)
# -----------------------------------------------------------------------------
@router.get("/api/tasks", response_model=list[MachineTaskDTO])
def list_tasks(
    machine_id: Optional[str] = None,
    status: Optional[str] = None,
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(MachineTask).options(selectinload(MachineTask.submission)).order_by(desc(MachineTask.created_at))
    if normalize_role(user.role) not in SUPERVISORY_ROLES:
        stmt = stmt.where(MachineTask.assigned_to == user.id)
    if machine_id:
        stmt = stmt.where(MachineTask.machine_id == machine_id)
    if status:
        stmt = stmt.where(MachineTask.status == status)
    return [MachineTaskDTO.model_validate(t) for t in db.scalars(stmt)]


@router.post("/api/tasks", response_model=MachineTaskDTO, status_code=201)
def create_task(
    payload: TaskCreateRequest,
    user: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    task = MachineTask(
        title=payload.title.strip(),
        description=(payload.description or "").strip(),
        task_type=payload.task_type,
        status="pending",
        machine_id=payload.machine_id,
        factory_id=payload.factory_id,
        shift_name=payload.shift_name,
        assigned_to=payload.assigned_to,
        created_by=user.id,
    )
    db.add(task)
    db.flush()
    record_audit_event(
        db,
        action="task_created",
        entity_type="task",
        entity_id=str(task.id),
        machine_id=task.machine_id,
        factory_id=task.factory_id,
        details=f"Created machine task '{task.title}'.",
        user=user,
    )
    db.commit()
    db.refresh(task)
    return MachineTaskDTO.model_validate(task)


@router.post("/api/tasks/{task_id}/submit")
async def submit_task_work(
    task_id: int,
    link: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    user: UserAccount = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(MachineTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if normalize_role(user.role) not in SUPERVISORY_ROLES and task.assigned_to != user.id:
        raise HTTPException(status_code=403, detail="You can only submit work for tasks assigned to you.")

    zip_path: Optional[str] = None
    if file and file.filename:
        filename = secure_filename(file.filename)
        if not filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Only .zip files are permitted.")
        save_name = f"task_{task.id}_{user.id}_{filename}"
        dest = Path(get_settings().upload_dir) / save_name
        content = await file.read()
        dest.write_bytes(content)
        zip_path = save_name

    if not link and not zip_path:
        raise HTTPException(status_code=400, detail="Provide either a work link or a .zip file.")

    sub = db.scalar(select(TaskSubmission).where(TaskSubmission.task_id == task.id))
    if not sub:
        sub = TaskSubmission(task_id=task.id, submitted_by=user.id, link=link, zip_path=zip_path)
        db.add(sub)
    else:
        sub.submitted_by = user.id
        if link:
            sub.link = link
        if zip_path:
            sub.zip_path = zip_path

    task.status = "submitted"
    record_audit_event(
        db,
        action="task_submitted",
        entity_type="task",
        entity_id=str(task.id),
        machine_id=task.machine_id,
        details=f"Work submitted for task '{task.title}'.",
        user=user,
    )
    db.commit()
    return {"message": "Work submitted successfully", "task_id": task.id, "status": task.status}


@router.put("/api/submissions/{sub_id}")
def review_submission(
    sub_id: int,
    status: str = Query(default="completed"),
    admin_notes: Optional[str] = Query(default=None),
    user: UserAccount = Depends(require_roles(*SUPERVISORY_ROLES)),
    db: Session = Depends(get_db),
):
    sub = db.get(TaskSubmission, sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if admin_notes is not None:
        sub.admin_notes = admin_notes
    if status in ("completed", "pending", "submitted"):
        sub.task.status = status
    record_audit_event(
        db,
        action="submission_reviewed",
        entity_type="task",
        entity_id=str(sub.task_id),
        machine_id=sub.task.machine_id,
        details=f"Submission #{sub_id} reviewed -> status={status}",
        user=user,
    )
    db.commit()
    return {"message": f"Task marked as '{status}'", "task_id": sub.task_id, "status": sub.task.status}


# -----------------------------------------------------------------------------
# Audit Trail
# -----------------------------------------------------------------------------
@router.get("/api/ps032/audit", response_model=list[AuditEventDTO])
def list_audit_events(
    machine_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    region_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(default=80, ge=1, le=250),
    user: Optional[UserAccount] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    stmt = select(AuditEvent).order_by(desc(AuditEvent.created_at), desc(AuditEvent.id)).limit(limit)
    if user is not None:
        role = normalize_role(user.role)
        permitted = get_permitted_machine_ids(db, user)
        if permitted is not None:
            if role == "factory_supervisor" and user.assigned_factory_id:
                stmt = stmt.where(
                    or_(
                        AuditEvent.machine_id.in_(permitted or {"__none__"}),
                        AuditEvent.factory_id == user.assigned_factory_id,
                    )
                )
            elif role == "regional_manager" and user.assigned_region_id:
                stmt = stmt.where(
                    or_(
                        AuditEvent.machine_id.in_(permitted or {"__none__"}),
                        AuditEvent.region_id == user.assigned_region_id,
                    )
                )
            else:
                stmt = stmt.where(AuditEvent.machine_id.in_(permitted or {"__none__"}))
    if machine_id:
        if user is not None:
            assert_machine_access(db, user, machine_id)
        stmt = stmt.where(AuditEvent.machine_id == machine_id)
    if factory_id:
        stmt = stmt.where(AuditEvent.factory_id == factory_id)
    if region_id:
        stmt = stmt.where(AuditEvent.region_id == region_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    return [AuditEventDTO.model_validate(a) for a in db.scalars(stmt)]

