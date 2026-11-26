"""Industrial analytics: Machine Health Score, Energy Monitoring, Production vs Target, Downtime & Factory KPIs."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.models import Factory, Machine, MachineEvent, MachineState, ProductionLine, Region, SensorReading
from app.models_ps032 import (
    Abnormality,
    DowntimeEvent,
    HandoverRecord,
    MaintenanceSchedule,
    ProductionEntry,
    QualityInspection,
)


def compute_machine_health(db: Session, machine_id: str) -> dict:
    """Compute an explainable, transparent Machine Health Score (0-100) from simulated/recorded data."""
    machine = db.scalar(
        select(Machine)
        .where(Machine.id == machine_id)
        .options(selectinload(Machine.state), selectinload(Machine.specification))
    )
    if not machine or not machine.state:
        return {"machine_id": machine_id, "score": 0, "category": "Unknown", "factors": [], "trend": [], "is_estimated": True}

    st = machine.state
    spec = machine.specification
    limits = (spec.operating_limits if spec and spec.operating_limits else {}) or {}
    max_temp = float(limits.get("max_temp_c", 72.0))
    max_vib = float(limits.get("max_vibration_mm_s", 4.0))

    readings = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.machine_id == machine_id)
            .order_by(desc(SensorReading.timestamp))
            .limit(20)
        )
    )
    readings.reverse()

    open_abns = list(
        db.scalars(
            select(Abnormality).where(Abnormality.machine_id == machine_id, Abnormality.status != "resolved")
        )
    )
    fault_events = list(
        db.scalars(
            select(MachineEvent)
            .where(MachineEvent.machine_id == machine_id, MachineEvent.event_type.in_(("fault_detected", "abnormality_reported")))
            .order_by(desc(MachineEvent.timestamp))
            .limit(20)
        )
    )
    downtime_rows = list(
        db.scalars(
            select(DowntimeEvent).where(DowntimeEvent.machine_id == machine_id).order_by(desc(DowntimeEvent.started_at)).limit(20)
        )
    )
    now = datetime.now(timezone.utc)
    overdue_scheds = [
        s
        for s in db.scalars(
            select(MaintenanceSchedule).where(MaintenanceSchedule.machine_id == machine_id, MaintenanceSchedule.status != "completed")
        )
        if (s.due_date.replace(tzinfo=timezone.utc) if s.due_date.tzinfo is None else s.due_date) < now
    ]

    score = 100.0
    factors: list[dict] = []
    recommendations: list[str] = []

    # 1. Current state & active faults
    if st.status == "Fault":
        score -= 32.0
        factors.append({"factor": "Active Machine Fault", "impact": -32, "detail": f"{st.active_fault_code or 'FAULT'}: {st.active_fault_message or 'Machine halted'}"})
        recommendations.append("Clear active fault and perform diagnostic inspection before restart.")
    elif st.status == "Maintenance":
        score -= 10.0
        factors.append({"factor": "Under Maintenance", "impact": -10, "detail": "Machine currently offline for scheduled/corrective service."})

    # 2. Temperature trend & limit margin
    temp = st.temperature_c
    if temp is not None:
        if temp >= max_temp:
            score -= 22.0
            factors.append({"factor": "Thermal Limit Breach", "impact": -22, "detail": f"Current temperature {temp}°C exceeds configured limit {max_temp}°C."})
            recommendations.append("Inspect coolant circulation, spindle bearings, and thermal sensor calibration.")
        elif temp >= max_temp * 0.9:
            score -= 10.0
            factors.append({"factor": "Elevated Temperature", "impact": -10, "detail": f"Temperature {temp}°C is within 10% of limit ({max_temp}°C)."})
            recommendations.append("Monitor thermal rise during continuous cycle passes.")

    # 3. Vibration trend & limit margin
    vib = st.vibration_mm_s
    if vib is not None:
        if vib >= max_vib:
            score -= 20.0
            factors.append({"factor": "High Vibration", "impact": -20, "detail": f"Vibration {vib} mm/s exceeds threshold {max_vib} mm/s."})
            recommendations.append("Check spindle runout, tooling balance, and mounting fasteners.")
        elif vib >= max_vib * 0.8:
            score -= 8.0
            factors.append({"factor": "Rising Vibration Trend", "impact": -8, "detail": f"Vibration {vib} mm/s approaching {max_vib} mm/s threshold."})

    # 4. Fault / Abnormality frequency
    if open_abns:
        penalty = min(18.0, len(open_abns) * 6.0)
        score -= penalty
        factors.append({"factor": "Open Abnormalities", "impact": -int(penalty), "detail": f"{len(open_abns)} unresolved abnormality report(s)."})
        recommendations.append("Review and resolve open abnormality tickets in PS-032.")
    elif len(fault_events) >= 3:
        score -= 8.0
        factors.append({"factor": "Recurring Fault History", "impact": -8, "detail": f"{len(fault_events)} historical fault events logged."})

    # 5. Downtime frequency
    total_dt = sum(d.duration_minutes for d in downtime_rows) + (st.downtime_min or 0.0)
    if total_dt >= 30.0:
        penalty = min(14.0, round(total_dt / 10.0, 1))
        score -= penalty
        factors.append({"factor": "Cumulative Downtime Loss", "impact": -int(penalty), "detail": f"{round(total_dt, 1)} min cumulative downtime recorded."})
        recommendations.append("Analyze top unplanned downtime causes and schedule preventive buffer.")

    # 6. Overdue preventive maintenance
    if overdue_scheds:
        penalty = min(15.0, len(overdue_scheds) * 8.0)
        score -= penalty
        factors.append({"factor": "Overdue Preventive Maintenance", "impact": -int(penalty), "detail": f"{len(overdue_scheds)} overdue maintenance schedule(s)."})
        recommendations.append(f"Execute overdue PM task: {overdue_scheds[0].title}.")

    score_int = max(0, min(100, int(round(score))))
    category = (
        "Healthy" if score_int >= 85 else ("Watch" if score_int >= 65 else ("Degraded" if score_int >= 45 else "Critical"))
    )
    if not recommendations:
        recommendations.append("Continue nominal operation and standard start-of-shift 5S checks.")

    trend = []
    for r in readings[-12:]:
        est = 100.0
        if r.status == "Fault":
            est -= 30.0
        if r.temperature_c and r.temperature_c >= max_temp * 0.9:
            est -= 12.0
        if r.vibration_mm_s and r.vibration_mm_s >= max_vib * 0.8:
            est -= 10.0
        trend.append(
            {
                "timestamp": r.timestamp.isoformat(),
                "estimated_score": max(0, min(100, int(est))),
                "temperature_c": r.temperature_c,
                "vibration_mm_s": r.vibration_mm_s,
            }
        )

    return {
        "machine_id": machine_id,
        "machine_code": machine.code,
        "score": score_int,
        "category": category,
        "is_estimated": True,
        "disclaimer": "Software-generated estimate based on simulated/recorded telemetry and operational history (not certified predictive accuracy).",
        "factors": factors,
        "recommendations": recommendations,
        "trend": trend,
    }


def compute_machine_energy(db: Session, machine_id: str) -> dict:
    """Compute machine energy consumption, unit intensity, downtime energy waste, and trend."""
    machine = db.scalar(select(Machine).where(Machine.id == machine_id).options(selectinload(Machine.state)))
    if not machine or not machine.state:
        return {"machine_id": machine_id, "current_kw": 0.0, "data_source": "simulation", "trend": []}

    st = machine.state
    readings = list(
        db.scalars(
            select(SensorReading)
            .where(SensorReading.machine_id == machine_id)
            .order_by(desc(SensorReading.timestamp))
            .limit(24)
        )
    )
    readings.reverse()

    # Estimate kWh across an 8h shift window from recorded power draw & runtime
    avg_kw = sum(r.energy_kw for r in readings if r.energy_kw is not None) / max(1, sum(1 for r in readings if r.energy_kw is not None))
    if avg_kw == 0 and st.energy_kw:
        avg_kw = st.energy_kw
    shift_kwh = round(avg_kw * 6.5, 2)  # representative active shift hours
    kwh_per_unit = round(shift_kwh / max(st.production_count, 1), 3)
    idle_standby_kw = round(max(1.8, avg_kw * 0.22), 2)
    downtime_loss_kwh = round(idle_standby_kw * ((st.downtime_min or 0.0) / 60.0), 2)

    return {
        "machine_id": machine.id,
        "machine_code": machine.code,
        "current_kw": round(st.energy_kw or 0.0, 2),
        "avg_kw": round(avg_kw, 2),
        "estimated_shift_kwh": shift_kwh,
        "kwh_per_unit": kwh_per_unit,
        "estimated_downtime_loss_kwh": downtime_loss_kwh,
        "data_source": st.data_source,
        "is_simulated": st.data_source not in ("plc", "opcua", "mqtt", "real_sensor"),
        "trend": [
            {
                "timestamp": r.timestamp.isoformat(),
                "energy_kw": r.energy_kw,
                "production_count": r.production_count,
                "status": r.status,
                "data_source": r.data_source,
            }
            for r in readings
        ],
    }


def build_factory_performance_analytics(
    db: Session,
    *,
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    permitted_machine_ids: Optional[set[str]] = None,
) -> dict:
    """Aggregate comprehensive OEE, Production vs Target, Downtime, Quality, Energy, Health, and Handovers."""
    stmt = (
        select(Machine)
        .join(ProductionLine, Machine.line_id == ProductionLine.id)
        .join(Factory, ProductionLine.factory_id == Factory.id)
        .options(
            selectinload(Machine.state),
            selectinload(Machine.production_line).selectinload(ProductionLine.factory).selectinload(Factory.region),
        )
    )
    if region_id:
        stmt = stmt.where(Factory.region_id == region_id)
    if factory_id:
        stmt = stmt.where(Factory.id == factory_id)
    if line_id:
        stmt = stmt.where(Machine.line_id == line_id)
    if machine_id:
        stmt = stmt.where(Machine.id == machine_id)
    if permitted_machine_ids is not None:
        if not permitted_machine_ids:
            machines = []
        else:
            stmt = stmt.where(Machine.id.in_(permitted_machine_ids))
            machines = list(db.scalars(stmt))
    else:
        machines = list(db.scalars(stmt))

    m_ids = [m.id for m in machines]

    # Query Production Entries with optional date/shift filters
    prod_stmt = select(ProductionEntry)
    dt_stmt = select(DowntimeEvent)
    qual_stmt = select(QualityInspection)
    ho_stmt = select(HandoverRecord)
    sched_stmt = select(MaintenanceSchedule)

    if m_ids:
        prod_stmt = prod_stmt.where(ProductionEntry.machine_id.in_(m_ids))
        dt_stmt = dt_stmt.where(DowntimeEvent.machine_id.in_(m_ids))
        qual_stmt = qual_stmt.where(QualityInspection.machine_id.in_(m_ids))
        ho_stmt = ho_stmt.where(HandoverRecord.machine_id.in_(m_ids))
        sched_stmt = sched_stmt.where(MaintenanceSchedule.machine_id.in_(m_ids))
    else:
        prod_stmt = prod_stmt.where(ProductionEntry.id == -1)
        dt_stmt = dt_stmt.where(DowntimeEvent.id == -1)
        qual_stmt = qual_stmt.where(QualityInspection.id == -1)
        ho_stmt = ho_stmt.where(HandoverRecord.id == "__none__")
        sched_stmt = sched_stmt.where(MaintenanceSchedule.id == -1)

    if shift_name:
        prod_stmt = prod_stmt.where(ProductionEntry.shift_name == shift_name)
        dt_stmt = dt_stmt.where(DowntimeEvent.shift_name == shift_name)
        qual_stmt = qual_stmt.where(QualityInspection.shift_name == shift_name)

    if start_date:
        start_dt = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        prod_stmt = prod_stmt.where(ProductionEntry.recorded_at >= start_dt)
        dt_stmt = dt_stmt.where(DowntimeEvent.started_at >= start_dt)
        qual_stmt = qual_stmt.where(QualityInspection.inspected_at >= start_dt)

    if end_date:
        end_dt = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)
        prod_stmt = prod_stmt.where(ProductionEntry.recorded_at < end_dt)
        dt_stmt = dt_stmt.where(DowntimeEvent.started_at < end_dt)
        qual_stmt = qual_stmt.where(QualityInspection.inspected_at < end_dt)

    prod_entries = list(db.scalars(prod_stmt))
    downtime_events = list(db.scalars(dt_stmt))
    quality_rows = list(db.scalars(qual_stmt))
    handovers = list(db.scalars(ho_stmt))
    schedules = list(db.scalars(sched_stmt))

    # Overall OEE, A/P/Q & Target Achievement from live machine states
    avails, perfs, quals, oees = [], [], [], []
    total_actual = 0
    total_target = 0
    total_energy_kw = 0.0
    line_agg: dict[str, dict] = {}
    health_dist = {"Healthy": 0, "Watch": 0, "Degraded": 0, "Critical": 0}
    health_scores: list[int] = []

    for m in machines:
        st = m.state
        if not st:
            continue
        avails.append(st.availability_pct)
        perfs.append(st.performance_pct)
        quals.append(st.quality_pct)
        oees.append(st.oee_pct)
        total_actual += st.production_count
        total_target += st.production_target
        total_energy_kw += st.energy_kw or 0.0

        line = m.production_line
        if line.id not in line_agg:
            line_agg[line.id] = {
                "line_id": line.id,
                "line_name": line.name,
                "line_code": line.code,
                "factory_name": line.factory.name,
                "actual": 0,
                "target": 0,
                "oee_list": [],
            }
        line_agg[line.id]["actual"] += st.production_count
        line_agg[line.id]["target"] += st.production_target
        line_agg[line.id]["oee_list"].append(st.oee_pct)

        h = compute_machine_health(db, m.id)
        health_scores.append(h["score"])
        if h["category"] in health_dist:
            health_dist[h["category"]] += 1

    # Shift-wise production breakdown from ProductionEntry
    shift_agg: dict[str, dict] = defaultdict(lambda: {"shift_name": "", "actual": 0, "target": 0, "rejects": 0, "good": 0, "entries": 0})
    total_rejects = 0
    for p in prod_entries:
        total_rejects += p.reject_units
        good = max(0, p.units_produced - p.reject_units)
        s = shift_agg[p.shift_name]
        s["shift_name"] = p.shift_name
        s["actual"] += p.units_produced
        s["target"] += p.target_units
        s["rejects"] += p.reject_units
        s["good"] += good
        s["entries"] += 1

    shift_summary = []
    for s in shift_agg.values():
        s["achievement_pct"] = round((s["actual"] / max(s["target"], 1)) * 100.0, 1)
        shift_summary.append(s)

    line_comparison = []
    for l in line_agg.values():
        line_comparison.append(
            {
                "line_id": l["line_id"],
                "line_code": l["line_code"],
                "line_name": l["line_name"],
                "factory_name": l["factory_name"],
                "actual": l["actual"],
                "target": l["target"],
                "achievement_pct": round((l["actual"] / max(l["target"], 1)) * 100.0, 1),
                "avg_oee": round(sum(l["oee_list"]) / max(len(l["oee_list"]), 1), 1),
            }
        )

    # Downtime summary
    planned_dt = round(sum(d.duration_minutes for d in downtime_events if d.category == "planned"), 1)
    unplanned_dt = round(sum(d.duration_minutes for d in downtime_events if d.category == "unplanned"), 1)
    reason_totals: dict[str, float] = defaultdict(float)
    for d in downtime_events:
        reason_totals[d.reason_category] += d.duration_minutes
    top_downtime_causes = [
        {"reason_category": k, "duration_minutes": round(v, 1)}
        for k, v in sorted(reason_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]

    # Overdue maintenance count
    now = datetime.now(timezone.utc)
    overdue_count = sum(
        1
        for s in schedules
        if s.status != "completed"
        and (s.due_date.replace(tzinfo=timezone.utc) if s.due_date.tzinfo is None else s.due_date) < now
    )

    pending_handovers = sum(1 for h in handovers if h.status == "pending")
    defect_totals: dict[str, dict] = defaultdict(lambda: {"defect_category": "", "rejected_qty": 0, "reworked_qty": 0, "inspected_qty": 0})
    for q in quality_rows:
        d = defect_totals[q.defect_category]
        d["defect_category"] = q.defect_category
        d["rejected_qty"] += q.rejected_qty
        d["reworked_qty"] += q.reworked_qty
        d["inspected_qty"] += q.inspected_qty

    good_production = max(0, total_actual - total_rejects)
    return {
        "scope": {
            "machines_count": len(machines),
            "region_id": region_id,
            "factory_id": factory_id,
            "line_id": line_id,
            "machine_id": machine_id,
            "shift_name": shift_name,
        },
        "kpis": {
            "overall_oee": round(sum(oees) / max(len(oees), 1), 1) if oees else 0.0,
            "availability_pct": round(sum(avails) / max(len(avails), 1), 1) if avails else 0.0,
            "performance_pct": round(sum(perfs) / max(len(perfs), 1), 1) if perfs else 0.0,
            "quality_pct": round(sum(quals) / max(len(quals), 1), 1) if quals else 0.0,
            "total_actual_production": total_actual,
            "total_target_production": total_target,
            "total_rejected_units": total_rejects,
            "total_good_production": good_production,
            "target_achievement_pct": round((total_actual / max(total_target, 1)) * 100.0, 1) if total_target else 0.0,
            "planned_downtime_min": planned_dt,
            "unplanned_downtime_min": unplanned_dt,
            "total_downtime_min": round(planned_dt + unplanned_dt, 1),
            "avg_machine_health_score": round(sum(health_scores) / max(len(health_scores), 1), 1) if health_scores else 0.0,
            "pending_handovers": pending_handovers,
            "maintenance_overdue_count": overdue_count,
            "total_power_kw": round(total_energy_kw, 1),
        },
        "health_distribution": health_dist,
        "line_comparison": line_comparison,
        "shift_production_summary": shift_summary,
        "top_downtime_causes": top_downtime_causes,
        "quality_by_category": list(defect_totals.values()),
    }
