"""Telemetry ingestion, OEE aggregation, and hierarchical Digital Twin builders."""

from datetime import datetime, timezone
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import (
    Company,
    Factory,
    Machine,
    MachineEvent,
    MachineState,
    ProductionLine,
    Region,
    SensorReading,
)
from app.schemas import (
    CompanyHierarchyDTO,
    CompanyOverviewDTO,
    FactoryDetailDTO,
    FactorySummaryDTO,
    FactoryTreeDTO,
    MachineDetailDTO,
    MachineEventDTO,
    MachineSpecificationDTO,
    MachineStateDTO,
    MachineSummaryDTO,
    OperationalSummaryDTO,
    ProductionLineDetailDTO,
    ProductionLineSummaryDTO,
    RegionDetailDTO,
    RegionSummaryDTO,
    RegionTreeDTO,
    SensorReadingDTO,
    TelemetryIngestItem,
)
from app.models_ps032 import MaintenanceRecord, MaintenanceSchedule
from app.services.ps032_adapter import ps032_adapter
from app.services.shift_engine import resolve_shift_context


def _compute_maintenance_counts(db: Session, machine_ids: list[str]) -> tuple[int, int]:
    if not machine_ids:
        return 0, 0
    open_recs = len(
        list(
            db.scalars(
                select(MaintenanceRecord.id).where(
                    MaintenanceRecord.machine_id.in_(machine_ids),
                    MaintenanceRecord.status != "completed",
                )
            )
        )
    )
    now = datetime.now(timezone.utc)
    overdue_scheds = sum(
        1
        for s in db.scalars(
            select(MaintenanceSchedule).where(
                MaintenanceSchedule.machine_id.in_(machine_ids),
                MaintenanceSchedule.status != "completed",
            )
        )
        if (s.due_date.replace(tzinfo=timezone.utc) if s.due_date.tzinfo is None else s.due_date) < now
    )
    return open_recs, overdue_scheds


def _is_stale(last_sync: datetime) -> bool:
    threshold = get_settings().stale_threshold_sec
    if last_sync.tzinfo is None:
        last_sync = last_sync.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last_sync).total_seconds() > threshold


def _to_state_dto(state: MachineState | None) -> MachineStateDTO | None:
    if state is None:
        return None
    return MachineStateDTO(
        status=state.status,
        data_source=state.data_source,
        sensor_connectivity=state.sensor_connectivity,
        assigned_operator=state.assigned_operator,
        production_count=state.production_count,
        production_target=state.production_target,
        temperature_c=state.temperature_c,
        vibration_mm_s=state.vibration_mm_s,
        cycle_time_sec=state.cycle_time_sec,
        energy_kw=state.energy_kw,
        downtime_min=state.downtime_min,
        availability_pct=state.availability_pct,
        performance_pct=state.performance_pct,
        quality_pct=state.quality_pct,
        oee_pct=state.oee_pct,
        active_fault_code=state.active_fault_code,
        active_fault_message=state.active_fault_message,
        handover_status=state.handover_status,
        last_sync_at=state.last_sync_at,
        is_stale=_is_stale(state.last_sync_at),
    )


def _to_machine_summary(machine: Machine) -> MachineSummaryDTO:
    return MachineSummaryDTO(
        id=machine.id,
        line_id=machine.line_id,
        name=machine.name,
        code=machine.code,
        machine_type=machine.machine_type,
        sequence_order=machine.sequence_order,
        pos_x=machine.pos_x,
        pos_y=machine.pos_y,
        pos_z=machine.pos_z,
        rotation_y=machine.rotation_y,
        qr_token=machine.qr_token,
        state=_to_state_dto(machine.state),
    )


def _aggregate_machines(
    machines: list[Machine],
    *,
    regions_count: int = 0,
    factories_count: int = 0,
    lines_count: int = 0,
) -> OperationalSummaryDTO:
    summary = OperationalSummaryDTO(
        total_regions=regions_count,
        total_factories=factories_count,
        total_lines=lines_count,
        total_machines=len(machines),
    )
    oee_values: list[float] = []
    for m in machines:
        st = m.state
        if not st:
            continue
        status = st.status
        if status == "Running":
            summary.running_machines += 1
        elif status == "Idle":
            summary.idle_machines += 1
        elif status == "Stopped":
            summary.stopped_machines += 1
        elif status == "Fault":
            summary.faulted_machines += 1
            summary.active_abnormalities += 1
        elif status == "Maintenance":
            summary.maintenance_machines += 1
        else:
            summary.offline_machines += 1

        summary.total_production += st.production_count
        summary.total_target += st.production_target
        oee_values.append(st.oee_pct)
        if st.handover_status == "pending":
            summary.pending_handovers += 1

    summary.overall_oee = round(sum(oee_values) / len(oee_values), 1) if oee_values else 0.0
    return summary


def _build_line_dtos(
    factory: Factory,
    *,
    permitted_machine_ids: set[str] | None = None,
) -> tuple[list[ProductionLineSummaryDTO], list[Machine]]:
    line_dtos: list[ProductionLineSummaryDTO] = []
    fac_machines: list[Machine] = []
    for line in sorted(factory.production_lines, key=lambda l: l.line_index):
        ordered_machines = sorted(line.machines, key=lambda m: m.sequence_order)
        if permitted_machine_ids is not None:
            ordered_machines = [m for m in ordered_machines if m.id in permitted_machine_ids]
            if not ordered_machines:
                continue
        fac_machines.extend(ordered_machines)
        line_summary = _aggregate_machines(ordered_machines, lines_count=1)
        line_dtos.append(
            ProductionLineSummaryDTO(
                id=line.id,
                factory_id=factory.id,
                name=line.name,
                code=line.code,
                process_type=line.process_type,
                line_index=line.line_index,
                floor_offset_z=line.floor_offset_z,
                target_oee=line.target_oee,
                summary=line_summary,
                machines=[_to_machine_summary(m) for m in ordered_machines],
            )
        )
    return line_dtos, fac_machines


def build_company_hierarchy(
    db: Session,
    *,
    permitted_machine_ids: set[str] | None = None,
) -> CompanyHierarchyDTO:
    company = db.scalar(
        select(Company).options(
            selectinload(Company.regions)
            .selectinload(Region.factories)
            .selectinload(Factory.production_lines)
            .selectinload(ProductionLine.machines)
            .selectinload(Machine.state)
        )
    )
    if company is None:
        raise ValueError("No company seeded in database")

    region_dtos: list[RegionTreeDTO] = []
    all_machines: list[Machine] = []
    total_factories = 0
    total_lines = 0

    for region in company.regions:
        factory_dtos: list[FactoryTreeDTO] = []
        region_machines: list[Machine] = []
        region_lines_count = 0

        for factory in region.factories:
            line_dtos, fac_machines = _build_line_dtos(
                factory,
                permitted_machine_ids=permitted_machine_ids,
            )
            if permitted_machine_ids is not None and not fac_machines:
                continue
            region_machines.extend(fac_machines)
            region_lines_count += len(line_dtos)
            fac_summary = _aggregate_machines(
                fac_machines,
                factories_count=1,
                lines_count=len(line_dtos),
            )
            fac_summary.open_maintenance_orders, fac_summary.overdue_maintenance_orders = _compute_maintenance_counts(
                db, [m.id for m in fac_machines]
            )
            fac_shift = resolve_shift_context(
                db,
                region.id,
                factory.id,
                handover_pending_count=fac_summary.pending_handovers,
            )
            factory_dtos.append(
                FactoryTreeDTO(
                    id=factory.id,
                    region_id=region.id,
                    name=factory.name,
                    code=factory.code,
                    facility_type=factory.facility_type,
                    timezone=factory.timezone or region.timezone,
                    floor_width_m=factory.floor_width_m,
                    floor_depth_m=factory.floor_depth_m,
                    site_x=factory.site_x,
                    site_z=factory.site_z,
                    latitude=factory.latitude,
                    longitude=factory.longitude,
                    location_label=factory.location_label,
                    active_shift_name=fac_shift.current_shift.shift_name if fac_shift.current_shift else factory.active_shift_name,
                    summary=fac_summary,
                    shift_context=fac_shift,
                    production_lines=line_dtos,
                )
            )

        if permitted_machine_ids is not None and not factory_dtos:
            continue

        total_factories += len(factory_dtos)
        total_lines += region_lines_count
        all_machines.extend(region_machines)
        reg_summary = _aggregate_machines(
            region_machines,
            regions_count=1,
            factories_count=len(factory_dtos),
            lines_count=region_lines_count,
        )
        reg_summary.open_maintenance_orders, reg_summary.overdue_maintenance_orders = _compute_maintenance_counts(
            db, [m.id for m in region_machines]
        )
        reg_shift = resolve_shift_context(
            db,
            region.id,
            handover_pending_count=reg_summary.pending_handovers,
        )
        region_dtos.append(
            RegionTreeDTO(
                id=region.id,
                company_id=company.id,
                name=region.name,
                code=region.code,
                country=region.country,
                timezone=region.timezone,
                map_x=region.map_x,
                map_z=region.map_z,
                latitude=region.latitude,
                longitude=region.longitude,
                description=region.description,
                summary=reg_summary,
                shift_context=reg_shift,
                company_name=company.name,
                factories=factory_dtos,
            )
        )

    company_summary = _aggregate_machines(
        all_machines,
        regions_count=len(region_dtos),
        factories_count=total_factories,
        lines_count=total_lines,
    )
    company_summary.open_maintenance_orders, company_summary.overdue_maintenance_orders = _compute_maintenance_counts(
        db, [m.id for m in all_machines]
    )
    return CompanyHierarchyDTO(
        id=company.id,
        name=company.name,
        code=company.code,
        headquarters=company.headquarters,
        industry_sector=company.industry_sector,
        description=company.description,
        latitude=company.latitude,
        longitude=company.longitude,
        summary=company_summary,
        regions=region_dtos,
    )


def build_company_overview(
    db: Session,
    *,
    permitted_machine_ids: set[str] | None = None,
) -> CompanyOverviewDTO:
    hierarchy = build_company_hierarchy(db, permitted_machine_ids=permitted_machine_ids)
    return CompanyOverviewDTO(
        id=hierarchy.id,
        name=hierarchy.name,
        code=hierarchy.code,
        headquarters=hierarchy.headquarters,
        industry_sector=hierarchy.industry_sector,
        description=hierarchy.description,
        latitude=hierarchy.latitude,
        longitude=hierarchy.longitude,
        summary=hierarchy.summary,
        regions=[
            RegionDetailDTO(
                id=r.id,
                company_id=r.company_id,
                name=r.name,
                code=r.code,
                country=r.country,
                timezone=r.timezone,
                map_x=r.map_x,
                map_z=r.map_z,
                latitude=r.latitude,
                longitude=r.longitude,
                description=r.description,
                summary=r.summary,
                shift_context=r.shift_context,
                company_name=r.company_name,
                factories=[
                    FactorySummaryDTO.model_validate(f.model_dump(exclude={"production_lines"}))
                    for f in r.factories
                ],
            )
            for r in hierarchy.regions
        ],
    )


def build_region_detail(
    db: Session,
    region_id: str,
    *,
    permitted_machine_ids: set[str] | None = None,
) -> RegionDetailDTO | None:
    overview = build_company_overview(db, permitted_machine_ids=permitted_machine_ids)
    for reg in overview.regions:
        if reg.id == region_id:
            return reg
    return None


def build_factory_detail(
    db: Session,
    factory_id: str,
    *,
    permitted_machine_ids: set[str] | None = None,
) -> FactoryDetailDTO | None:
    factory = db.scalar(
        select(Factory)
        .where(Factory.id == factory_id)
        .options(
            selectinload(Factory.region),
            selectinload(Factory.production_lines)
            .selectinload(ProductionLine.machines)
            .selectinload(Machine.state),
        )
    )
    if factory is None:
        return None

    line_dtos, all_machines = _build_line_dtos(
        factory,
        permitted_machine_ids=permitted_machine_ids,
    )

    fac_summary = _aggregate_machines(
        all_machines,
        factories_count=1,
        lines_count=len(line_dtos),
    )
    fac_shift = resolve_shift_context(
        db,
        factory.region_id,
        factory.id,
        handover_pending_count=fac_summary.pending_handovers,
    )
    return FactoryDetailDTO(
        id=factory.id,
        region_id=factory.region_id,
        region_name=factory.region.name,
        name=factory.name,
        code=factory.code,
        facility_type=factory.facility_type,
        timezone=factory.timezone or factory.region.timezone,
        floor_width_m=factory.floor_width_m,
        floor_depth_m=factory.floor_depth_m,
        site_x=factory.site_x,
        site_z=factory.site_z,
        latitude=factory.latitude,
        longitude=factory.longitude,
        location_label=factory.location_label,
        active_shift_name=fac_shift.current_shift.shift_name if fac_shift.current_shift else factory.active_shift_name,
        summary=fac_summary,
        shift_context=fac_shift,
        production_lines=line_dtos,
    )


def build_line_detail(db: Session, line_id: str) -> ProductionLineDetailDTO | None:
    line = db.scalar(
        select(ProductionLine)
        .where(ProductionLine.id == line_id)
        .options(
            selectinload(ProductionLine.factory).selectinload(Factory.region),
            selectinload(ProductionLine.machines).selectinload(Machine.state),
        )
    )
    if line is None:
        return None

    ordered_machines = sorted(line.machines, key=lambda m: m.sequence_order)
    summary = _aggregate_machines(ordered_machines, lines_count=1)
    shift_ctx = resolve_shift_context(
        db,
        line.factory.region_id,
        line.factory_id,
        handover_pending_count=summary.pending_handovers,
    )
    return ProductionLineDetailDTO(
        id=line.id,
        factory_id=line.factory_id,
        factory_name=line.factory.name,
        region_id=line.factory.region_id,
        region_name=line.factory.region.name,
        name=line.name,
        code=line.code,
        process_type=line.process_type,
        line_index=line.line_index,
        floor_offset_z=line.floor_offset_z,
        target_oee=line.target_oee,
        summary=summary,
        machines=[_to_machine_summary(m) for m in ordered_machines],
        shift_context=shift_ctx,
    )


def build_machine_detail(db: Session, machine_id: str) -> MachineDetailDTO | None:
    machine = db.scalar(
        select(Machine)
        .where(Machine.id == machine_id)
        .options(
            selectinload(Machine.specification),
            selectinload(Machine.state),
            selectinload(Machine.production_line)
            .selectinload(ProductionLine.factory)
            .selectinload(Factory.region),
        )
    )
    if machine is None:
        return None

    line = machine.production_line
    factory = line.factory
    region = factory.region
    shift_ctx = resolve_shift_context(
        db,
        region.id,
        factory.id,
        handover_pending_count=1 if (machine.state and machine.state.handover_status == "pending") else 0,
    )

    readings = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.machine_id == machine.id)
            .order_by(desc(SensorReading.timestamp))
            .limit(24)
        )
    )
    readings.reverse()

    events = list(
        db.scalars(
            select(MachineEvent)
            .where(MachineEvent.machine_id == machine.id)
            .order_by(desc(MachineEvent.timestamp))
            .limit(20)
        )
    )

    handover_status = machine.state.handover_status if machine.state else "complete"
    hook = ps032_adapter.get_machine_handover_hook(
        machine_id=machine.id,
        handover_status=handover_status,
        previous_shift_name=shift_ctx.previous_shift.shift_name if shift_ctx.previous_shift else None,
        current_shift_name=shift_ctx.current_shift.shift_name if shift_ctx.current_shift else None,
        db=db,
    )

    return MachineDetailDTO(
        id=machine.id,
        line_id=machine.line_id,
        line_name=line.name,
        factory_id=factory.id,
        factory_name=factory.name,
        region_id=region.id,
        region_name=region.name,
        name=machine.name,
        code=machine.code,
        machine_type=machine.machine_type,
        sequence_order=machine.sequence_order,
        pos_x=machine.pos_x,
        pos_y=machine.pos_y,
        pos_z=machine.pos_z,
        rotation_y=machine.rotation_y,
        qr_token=machine.qr_token,
        state=_to_state_dto(machine.state),
        specification=MachineSpecificationDTO.model_validate(machine.specification) if machine.specification else None,
        recent_readings=[SensorReadingDTO.model_validate(r) for r in readings],
        recent_events=[MachineEventDTO.model_validate(e) for e in events],
        shift_context=shift_ctx,
        handover_hook=hook,
    )


def ingest_telemetry_items(db: Session, items: list[TelemetryIngestItem]) -> list[dict]:
    """Apply telemetry updates to MachineState, record SensorReading & MachineEvent if changed."""
    updates: list[dict] = []
    now = datetime.now(timezone.utc)

    for item in items:
        machine = db.scalar(
            select(Machine)
            .where(Machine.id == item.machine_id)
            .options(
                selectinload(Machine.state),
                selectinload(Machine.production_line).selectinload(ProductionLine.factory),
            )
        )
        if not machine or not machine.state:
            continue

        state = machine.state
        prev_status = state.status
        line = machine.production_line
        factory = line.factory

        if item.status is not None:
            state.status = item.status
        if item.temperature_c is not None:
            state.temperature_c = round(item.temperature_c, 2)
        if item.vibration_mm_s is not None:
            state.vibration_mm_s = round(item.vibration_mm_s, 2)
        if item.cycle_time_sec is not None:
            state.cycle_time_sec = round(item.cycle_time_sec, 2)
        if item.energy_kw is not None:
            state.energy_kw = round(item.energy_kw, 2)

        if item.production_count is not None:
            state.production_count = item.production_count
        elif item.production_delta:
            state.production_count += item.production_delta

        if item.downtime_delta_min:
            state.downtime_min = round(state.downtime_min + item.downtime_delta_min, 2)

        state.data_source = item.data_source
        state.sensor_connectivity = item.sensor_connectivity
        state.last_sync_at = now

        if state.status == "Fault":
            state.active_fault_code = item.fault_code or state.active_fault_code or "E-500"
            state.active_fault_message = item.fault_message or state.active_fault_message or "Simulated machine fault"
        elif state.status == "Running":
            state.active_fault_code = None
            state.active_fault_message = None

        # Recompute coherent OEE metrics from availability, performance, quality
        avail = 94.0 if state.status == "Running" else (78.0 if state.status == "Idle" else 45.0 if state.status in ("Fault", "Maintenance") else 0.0)
        avail = max(0.0, round(avail - min(state.downtime_min * 0.25, 35.0), 1))
        perf = round(min(100.0, (state.production_count / max(state.production_target, 1)) * 100.0), 1)
        if state.status == "Running" and perf < 75.0:
            perf = round(max(perf, 84.0), 1)
        state.availability_pct = avail
        state.performance_pct = perf
        state.oee_pct = round((avail * perf * state.quality_pct) / 10000.0, 1)

        db.add(
            SensorReading(
                machine_id=machine.id,
                timestamp=now,
                status=state.status,
                temperature_c=state.temperature_c,
                vibration_mm_s=state.vibration_mm_s,
                cycle_time_sec=state.cycle_time_sec,
                energy_kw=state.energy_kw,
                production_count=state.production_count,
                data_source=state.data_source,
            )
        )

        event_dto: MachineEventDTO | None = None
        if prev_status != state.status or item.event_type:
            shift_ctx = resolve_shift_context(db, factory.region_id, factory.id)
            ev_type = item.event_type or ("fault_detected" if state.status == "Fault" else "state_change")
            severity = "critical" if state.status == "Fault" else ("warning" if state.status in ("Maintenance", "Idle", "Offline") else "info")
            msg = item.event_message or (
                f"{machine.name} transitioned {prev_status} -> {state.status}"
                + (f" ({state.active_fault_code}: {state.active_fault_message})" if state.status == "Fault" else "")
            )
            ev = MachineEvent(
                machine_id=machine.id,
                factory_id=factory.id,
                region_id=factory.region_id,
                line_id=line.id,
                shift_name=shift_ctx.current_shift.shift_name if shift_ctx.current_shift else None,
                event_type=ev_type,
                severity=severity,
                previous_status=prev_status,
                new_status=state.status,
                message=msg,
                data_source=state.data_source,
            )
            db.add(ev)
            db.flush()
            event_dto = MachineEventDTO.model_validate(ev)

        updates.append(
            {
                "machine_id": machine.id,
                "line_id": line.id,
                "factory_id": factory.id,
                "region_id": factory.region_id,
                "state": _to_state_dto(state).model_dump(mode="json"),
                "event": event_dto.model_dump(mode="json") if event_dto else None,
            }
        )

    db.commit()
    return updates

