"""Centralized PS-032 report aggregation, preview, and ReportLab A4 PDF/ZIP export service."""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape
import io
from pathlib import Path
import re
from typing import Any, Optional
import zipfile
from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import desc, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Company, Factory, Machine, ProductionLine, Region
from app.models_ps032 import (
    Abnormality,
    AuditEvent,
    Cleaning5SLog,
    HandoverRecord,
    MaintenanceRecord,
    ProductionEntry,
    QualityInspection,
    SafetyChecklist,
    UserAccount,
)
from app.services.access_control import (
    assert_factory_access,
    assert_machine_access,
    assert_region_access,
    get_permitted_machine_ids,
)
from app.services.auth_service import normalize_role, record_audit_event
from app.services.handover_pipeline import _NumberedFooterCanvas, publish_pdf

REPORT_CATEGORY_LABELS = {
    "shift_handover": "Shift Handover Report",
    "production": "Production Report",
    "abnormality": "Abnormality & Fault Report",
    "maintenance": "Maintenance Report",
    "safety_checklist": "Safety Checklist Report",
    "quality": "Quality & Defect Report",
    "cleaning_5s": "5S & Cleaning Report",
    "machine_oee": "Machine Performance & OEE",
    "audit": "Audit Trail Report",
}

MAINTENANCE_ENGINEER_CATEGORIES = {
    "maintenance",
    "abnormality",
    "safety_checklist",
    "shift_handover",
    "machine_oee",
}


def _safe_filename(raw: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw.strip())
    return re.sub(r"_+", "_", cleaned).strip("_") or "PS032_Report"


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(str(text if text is not None else "—")), style)


def _to_utc(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _date_in_range(dt: datetime, start_date: Optional[str], end_date: Optional[str]) -> bool:
    d_str = _to_utc(dt).strftime("%Y-%m-%d")
    if start_date and d_str < start_date:
        return False
    if end_date and d_str > end_date:
        return False
    return True


def _load_hierarchy_maps(db: Session) -> dict[str, Any]:
    company = db.scalar(select(Company).limit(1))
    regions = {r.id: r for r in db.scalars(select(Region))}
    factories = {f.id: f for f in db.scalars(select(Factory))}
    lines = {l.id: l for l in db.scalars(select(ProductionLine))}
    machines = {
        m.id: m
        for m in db.scalars(select(Machine).options(selectinload(Machine.state)))
    }
    return {
        "company_name": company.name if company else "Apex Precision Manufacturing",
        "regions": regions,
        "factories": factories,
        "lines": lines,
        "machines": machines,
    }


def _deny_and_audit(
    db: Session,
    user: UserAccount,
    *,
    action_label: str,
    detail: str,
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    report_uid: Optional[str] = None,
) -> None:
    role = normalize_role(user.role)
    record_audit_event(
        db,
        action="unauthorized_report_access_attempt",
        entity_type="report",
        entity_id=report_uid or factory_id or region_id or "centralized_reports",
        machine_id=machine_id,
        factory_id=factory_id,
        region_id=region_id,
        details=(
            f"Blocked unauthorized {action_label} by {user.email} "
            f"(role={role}, authorized_region={user.assigned_region_id or 'none'}, "
            f"authorized_factory={user.assigned_factory_id or 'none'}): {detail}"
        ),
        user=user,
    )
    db.commit()
    raise HTTPException(status_code=403, detail=detail)


def _enforce_centralized_report_scope(
    db: Session,
    user: UserAccount,
    *,
    action_label: str,
    scope: Optional[str] = None,
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    report_uid: Optional[str] = None,
) -> str:
    role = normalize_role(user.role)
    if role not in ("company_admin", "regional_manager"):
        _deny_and_audit(
            db,
            user,
            action_label=action_label,
            detail="Access denied: Centralized Reports are restricted to Company Admin and Regional Manager roles.",
            region_id=region_id,
            factory_id=factory_id,
            machine_id=machine_id,
            report_uid=report_uid,
        )

    if scope == "company" and role != "company_admin":
        _deny_and_audit(
            db,
            user,
            action_label=action_label,
            detail="Only Company Admin can access or export company-wide consolidated reports.",
            region_id=region_id,
            factory_id=factory_id,
            machine_id=machine_id,
            report_uid=report_uid,
        )

    if role == "regional_manager" and not user.assigned_region_id:
        _deny_and_audit(
            db,
            user,
            action_label=action_label,
            detail="Regional Manager account lacks an assigned region for centralized report access.",
            region_id=region_id,
            factory_id=factory_id,
            machine_id=machine_id,
            report_uid=report_uid,
        )

    try:
        if region_id:
            assert_region_access(db, user, region_id)
        if factory_id:
            assert_factory_access(db, user, factory_id)
        if line_id:
            line = db.get(ProductionLine, line_id)
            if line is not None:
                assert_factory_access(db, user, line.factory_id)
        if machine_id:
            assert_machine_access(db, user, machine_id)
    except HTTPException as exc:
        _deny_and_audit(
            db,
            user,
            action_label=action_label,
            detail=str(exc.detail),
            region_id=region_id,
            factory_id=factory_id,
            machine_id=machine_id,
            report_uid=report_uid,
        )

    return role


def query_centralized_reports(
    db: Session,
    user: UserAccount,
    *,
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict[str, Any]:
    """Query unified industrial reports across authorized hierarchy levels (Company Admin & Regional Manager only)."""
    role = _enforce_centralized_report_scope(
        db,
        user,
        action_label="report_list",
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
    )
    permitted_machines = get_permitted_machine_ids(db, user)

    hmap = _load_hierarchy_maps(db)
    company_name = hmap["company_name"]
    regions = hmap["regions"]
    factories = hmap["factories"]
    lines = hmap["lines"]
    machines = hmap["machines"]

    items: list[dict[str, Any]] = []

    def _ctx_for_machine(mid: Optional[str], fid: Optional[str] = None, rid: Optional[str] = None):
        m = machines.get(mid) if mid else None
        l = lines.get(m.line_id) if m else None
        fac_id = fid or (l.factory_id if l else None)
        f = factories.get(fac_id) if fac_id else None
        reg_id = rid or (f.region_id if f else None)
        r = regions.get(reg_id) if reg_id else None
        return m, l, f, r

    def _append_item(
        *,
        uid: str,
        cat: str,
        title: str,
        m_id: Optional[str],
        f_id: Optional[str],
        r_id: Optional[str],
        shift: Optional[str],
        actor_name: Optional[str],
        supervisor_name: Optional[str],
        item_status: str,
        recorded_at: datetime,
        existing_pdf: Optional[str] = None,
        summary_line: str = "",
        raw_details: Optional[dict[str, Any]] = None,
    ) -> None:
        if category and cat != category:
            return
        m, l, f, r = _ctx_for_machine(m_id, f_id, r_id)
        eff_r_id = r.id if r else (r_id or "")
        eff_f_id = f.id if f else (f_id or "")
        eff_l_id = l.id if l else ""
        eff_m_id = m.id if m else (m_id or "")

        if permitted_machines is not None:
            if eff_m_id:
                if eff_m_id not in permitted_machines:
                    return
            elif role == "factory_supervisor" and user.assigned_factory_id != eff_f_id:
                return
            elif role == "regional_manager" and user.assigned_region_id != eff_r_id:
                return
            elif role in ("operator", "maintenance_engineer"):
                return

        if region_id and eff_r_id != region_id:
            return
        if factory_id and eff_f_id != factory_id:
            return
        if line_id and eff_l_id != line_id:
            return
        if machine_id and eff_m_id != machine_id:
            return
        if status and item_status.lower() != status.lower():
            return
        if shift_name and (shift or "").lower() != shift_name.lower():
            return
        if not _date_in_range(recorded_at, start_date, end_date):
            return

        items.append(
            {
                "report_uid": uid,
                "category": cat,
                "category_label": REPORT_CATEGORY_LABELS.get(cat, cat),
                "title": title,
                "company_name": company_name,
                "region_id": eff_r_id or None,
                "region_name": r.name if r else "Enterprise-Wide",
                "factory_id": eff_f_id or None,
                "factory_name": f.name if f else "All Plants",
                "line_id": eff_l_id or None,
                "line_name": l.name if l else "—",
                "machine_id": eff_m_id or None,
                "machine_code": m.code if m else "—",
                "machine_name": m.name if m else "—",
                "shift_name": shift or "—",
                "operator_or_actor": actor_name or "System",
                "supervisor_name": supervisor_name or "—",
                "status": item_status,
                "recorded_at": _to_utc(recorded_at).isoformat(),
                "existing_pdf_filename": existing_pdf,
                "summary_line": summary_line,
                "raw_details": raw_details or {},
            }
        )

    # 1. Shift Handovers
    for ho in db.scalars(select(HandoverRecord).order_by(desc(HandoverRecord.created_at))):
        m = machines.get(ho.machine_id)
        m_code = m.code if m else ho.machine_id
        _append_item(
            uid=f"shift_handover:{ho.id}",
            cat="shift_handover",
            title=f"Shift Handover — {m_code} ({ho.previous_shift_name} -> {ho.incoming_shift_name})",
            m_id=ho.machine_id,
            f_id=ho.factory_id,
            r_id=ho.region_id,
            shift=ho.previous_shift_name,
            actor_name=ho.outgoing_operator or ho.acknowledged_by_name,
            supervisor_name=ho.supervisor_name,
            item_status=ho.status,
            recorded_at=ho.created_at,
            existing_pdf=ho.pdf_filename,
            summary_line=(
                f"Output {ho.production_completed}/{ho.production_target} pcs | "
                f"DT {ho.downtime_minutes}m | Open Abn {ho.pending_abnormalities_count} | "
                f"Condition: {ho.machine_condition}"
            ),
            raw_details={
                "handover_id": ho.id,
                "previous_shift": ho.previous_shift_name,
                "incoming_shift": ho.incoming_shift_name,
                "shift_window": ho.shift_window_label,
                "outgoing_operator": ho.outgoing_operator,
                "incoming_operator": ho.incoming_operator,
                "acknowledged_by": ho.acknowledged_by_name,
                "acknowledged_at": _to_utc(ho.acknowledged_at).isoformat() if ho.acknowledged_at else None,
                "acknowledgement_remarks": ho.acknowledgement_remarks,
                "production_completed": ho.production_completed,
                "production_target": ho.production_target,
                "downtime_minutes": ho.downtime_minutes,
                "pending_abnormalities_count": ho.pending_abnormalities_count,
                "operator_remarks": ho.operator_remarks,
                "maintenance_instructions": ho.maintenance_instructions,
                "cleaning_summary": ho.cleaning_summary,
                "safety_observations": ho.safety_observations,
            },
        )

    # 2. Production Entries
    for pe in db.scalars(select(ProductionEntry).order_by(desc(ProductionEntry.recorded_at))):
        m = machines.get(pe.machine_id)
        m_code = m.code if m else pe.machine_id
        good_units = max(0, pe.units_produced - pe.reject_units)
        pct = round((pe.units_produced / max(pe.target_units, 1)) * 100.0, 1)
        _append_item(
            uid=f"production:{pe.id}",
            cat="production",
            title=f"Production Entry — {m_code} ({pe.units_produced}/{pe.target_units} pcs)",
            m_id=pe.machine_id,
            f_id=pe.factory_id,
            r_id=pe.region_id,
            shift=pe.shift_name,
            actor_name=pe.operator_name,
            supervisor_name=None,
            item_status="on_target" if pct >= 85.0 else "below_target",
            recorded_at=pe.recorded_at,
            summary_line=f"Actual {pe.units_produced} | Target {pe.target_units} | Good {good_units} | Rejects {pe.reject_units} ({pct}%)",
            raw_details={
                "units_produced": pe.units_produced,
                "target_units": pe.target_units,
                "good_units": good_units,
                "reject_units": pe.reject_units,
                "achievement_pct": pct,
                "downtime_minutes": pe.downtime_minutes,
                "remarks": pe.remarks,
            },
        )

    # 3. Abnormalities
    for abn in db.scalars(select(Abnormality).order_by(desc(Abnormality.created_at))):
        m = machines.get(abn.machine_id)
        m_code = m.code if m else abn.machine_id
        _append_item(
            uid=f"abnormality:{abn.id}",
            cat="abnormality",
            title=f"{abn.code} — {m_code}: {abn.title}",
            m_id=abn.machine_id,
            f_id=abn.factory_id,
            r_id=abn.region_id,
            shift=abn.shift_name,
            actor_name=abn.reported_by_name,
            supervisor_name=abn.assigned_to_name,
            item_status=abn.status,
            recorded_at=abn.created_at,
            summary_line=f"Severity: {abn.severity.upper()} | Fault Code: {abn.fault_code or '—'} | {abn.description}",
            raw_details={
                "code": abn.code,
                "severity": abn.severity,
                "fault_code": abn.fault_code,
                "description": abn.description,
                "assigned_to": abn.assigned_to_name,
                "resolution_notes": abn.resolution_notes,
                "resolved_at": _to_utc(abn.resolved_at).isoformat() if abn.resolved_at else None,
            },
        )

    # 4. Maintenance Reports
    for mnt in db.scalars(select(MaintenanceRecord).order_by(desc(MaintenanceRecord.started_at))):
        m = machines.get(mnt.machine_id)
        m_code = m.code if m else mnt.machine_id
        _append_item(
            uid=f"maintenance:{mnt.id}",
            cat="maintenance",
            title=f"Maintenance ({mnt.maintenance_type.title()}) — {m_code}: {mnt.summary}",
            m_id=mnt.machine_id,
            f_id=mnt.factory_id,
            r_id=None,
            shift="Maintenance Window",
            actor_name=mnt.engineer_name,
            supervisor_name=None,
            item_status=mnt.status,
            recorded_at=mnt.started_at,
            summary_line=f"Type: {mnt.maintenance_type} | Parts: {mnt.parts_replaced or 'None'} | Notes: {mnt.inspection_notes or '—'}",
            raw_details={
                "maintenance_type": mnt.maintenance_type,
                "summary": mnt.summary,
                "inspection_notes": mnt.inspection_notes,
                "parts_replaced": mnt.parts_replaced,
                "engineer_name": mnt.engineer_name,
                "completed_at": _to_utc(mnt.completed_at).isoformat() if mnt.completed_at else None,
            },
        )

    # 5. Safety Checklists
    for sc in db.scalars(select(SafetyChecklist).order_by(desc(SafetyChecklist.submitted_at))):
        m = machines.get(sc.machine_id)
        m_code = m.code if m else sc.machine_id
        _append_item(
            uid=f"safety_checklist:{sc.id}",
            cat="safety_checklist",
            title=f"Safety Checklist — {m_code} ({sc.overall_status.upper()})",
            m_id=sc.machine_id,
            f_id=sc.factory_id,
            r_id=None,
            shift=sc.shift_name,
            actor_name=sc.submitted_by_name,
            supervisor_name=sc.reviewed_by_name,
            item_status=sc.overall_status,
            recorded_at=sc.submitted_at,
            summary_line=f"{len(sc.items_json)} checks | Critical Fail: {sc.has_critical_failure} | Review: {sc.supervisor_review_status}",
            raw_details={
                "items": sc.items_json,
                "overall_status": sc.overall_status,
                "has_critical_failure": sc.has_critical_failure,
                "operator_remarks": sc.operator_remarks,
                "supervisor_review_status": sc.supervisor_review_status,
                "supervisor_notes": sc.supervisor_notes,
                "escalated_abnormality_id": sc.escalated_abnormality_id,
            },
        )

    # 6. Quality & Defect Reports
    for qi in db.scalars(select(QualityInspection).order_by(desc(QualityInspection.inspected_at))):
        m = machines.get(qi.machine_id)
        m_code = m.code if m else qi.machine_id
        _append_item(
            uid=f"quality:{qi.id}",
            cat="quality",
            title=f"Quality Inspection — {m_code} ({qi.defect_category})",
            m_id=qi.machine_id,
            f_id=qi.factory_id,
            r_id=None,
            shift=qi.shift_name,
            actor_name=qi.inspector_name,
            supervisor_name=None,
            item_status="passed" if qi.rejected_qty == 0 else "defects_flagged",
            recorded_at=qi.inspected_at,
            summary_line=f"Inspected: {qi.inspected_qty} | Rejected: {qi.rejected_qty} | Reworked: {qi.reworked_qty} | Category: {qi.defect_category}",
            raw_details={
                "inspected_qty": qi.inspected_qty,
                "rejected_qty": qi.rejected_qty,
                "reworked_qty": qi.reworked_qty,
                "defect_category": qi.defect_category,
                "remarks": qi.remarks,
            },
        )

    # 7. 5S & Cleaning Reports
    for c5 in db.scalars(select(Cleaning5SLog).order_by(desc(Cleaning5SLog.logged_at))):
        m = machines.get(c5.machine_id)
        m_code = m.code if m else c5.machine_id
        passed_all = bool(c5.area_cleaned and c5.lubrication_checked and c5.guards_verified)
        _append_item(
            uid=f"cleaning_5s:{c5.id}",
            cat="cleaning_5s",
            title=f"5S & Cleaning Verification — {m_code}",
            m_id=c5.machine_id,
            f_id=None,
            r_id=None,
            shift=c5.shift_name,
            actor_name=c5.logged_by_name,
            supervisor_name=None,
            item_status="verified" if passed_all else "incomplete",
            recorded_at=c5.logged_at,
            summary_line=f"Cleaned={c5.area_cleaned} | Lube={c5.lubrication_checked} | Guards={c5.guards_verified} | {c5.safety_observations or 'No hazards'}",
            raw_details={
                "area_cleaned": c5.area_cleaned,
                "lubrication_checked": c5.lubrication_checked,
                "guards_verified": c5.guards_verified,
                "safety_observations": c5.safety_observations,
            },
        )

    # 8. Machine Performance & OEE Snapshot (real DB MachineState)
    for m in machines.values():
        st = m.state
        if not st:
            continue
        _append_item(
            uid=f"machine_oee:{m.id}",
            cat="machine_oee",
            title=f"OEE & Telemetry Snapshot — {m.code} ({st.oee_pct}%)",
            m_id=m.id,
            f_id=None,
            r_id=None,
            shift="Active Shift",
            actor_name=st.assigned_operator or "Unassigned",
            supervisor_name=None,
            item_status=st.status.lower(),
            recorded_at=st.last_sync_at,
            summary_line=(
                f"OEE {st.oee_pct}% (A {st.availability_pct}% P {st.performance_pct}% Q {st.quality_pct}%) | "
                f"Prod {st.production_count}/{st.production_target} | {st.temperature_c}°C ({st.data_source})"
            ),
            raw_details={
                "oee_pct": st.oee_pct,
                "availability_pct": st.availability_pct,
                "performance_pct": st.performance_pct,
                "quality_pct": st.quality_pct,
                "production_count": st.production_count,
                "production_target": st.production_target,
                "temperature_c": st.temperature_c,
                "vibration_mm_s": st.vibration_mm_s,
                "energy_kw": st.energy_kw,
                "downtime_min": st.downtime_min,
                "data_source": st.data_source,
            },
        )

    # 9. Audit Trail Reports
    for aud in db.scalars(select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(100)):
        _append_item(
            uid=f"audit:{aud.id}",
            cat="audit",
            title=f"Audit Log — {aud.action} ({aud.entity_type}:{aud.entity_id})",
            m_id=aud.machine_id,
            f_id=aud.factory_id,
            r_id=aud.region_id,
            shift="System Event",
            actor_name=aud.actor_name or "System",
            supervisor_name=aud.actor_role,
            item_status="logged",
            recorded_at=aud.created_at,
            summary_line=aud.details,
            raw_details={
                "action": aud.action,
                "entity_type": aud.entity_type,
                "entity_id": aud.entity_id,
                "actor_role": aud.actor_role,
                "details": aud.details,
            },
        )

    items.sort(key=lambda x: x["recorded_at"], reverse=True)

    factories_covered = len({it["factory_id"] for it in items if it.get("factory_id")})
    pending_handovers = sum(1 for it in items if it["category"] == "shift_handover" and it["status"] == "pending")
    acknowledged_handovers = sum(
        1 for it in items if it["category"] == "shift_handover" and it["status"] == "acknowledged"
    )
    open_abnormalities = sum(
        1 for it in items if it["category"] == "abnormality" and it["status"] in ("open", "investigating")
    )
    maintenance_reports = sum(1 for it in items if it["category"] == "maintenance")

    return {
        "summary": {
            "total_reports": len(items),
            "pending_handovers": pending_handovers,
            "acknowledged_handovers": acknowledged_handovers,
            "open_abnormalities": open_abnormalities,
            "maintenance_reports": maintenance_reports,
            "factories_covered": factories_covered,
        },
        "reports": items,
    }


def build_report_preview_payload(db: Session, user: UserAccount, report_uid: str) -> dict[str, Any]:
    """Retrieve a single report with contextual abnormalities, maintenance, handover, and audit trail."""
    _enforce_centralized_report_scope(db, user, action_label="report_preview", report_uid=report_uid)
    all_data = query_centralized_reports(db, user)
    target = next((r for r in all_data["reports"] if r["report_uid"] == report_uid), None)
    if not target:
        # Check if entity exists outside user scope -> raise 403 & audit rather than 404 when unauthorized
        if ":" in report_uid:
            cat, raw_id = report_uid.split(":", 1)
            exists = False
            if cat == "shift_handover" and db.get(HandoverRecord, raw_id):
                exists = True
            elif cat == "production" and raw_id.isdigit() and db.get(ProductionEntry, int(raw_id)):
                exists = True
            elif cat == "abnormality" and raw_id.isdigit() and db.get(Abnormality, int(raw_id)):
                exists = True
            elif cat == "maintenance" and raw_id.isdigit() and db.get(MaintenanceRecord, int(raw_id)):
                exists = True
            elif cat == "safety_checklist" and raw_id.isdigit() and db.get(SafetyChecklist, int(raw_id)):
                exists = True
            elif cat == "quality" and raw_id.isdigit() and db.get(QualityInspection, int(raw_id)):
                exists = True
            elif cat == "cleaning_5s" and raw_id.isdigit() and db.get(Cleaning5SLog, int(raw_id)):
                exists = True
            elif cat == "machine_oee" and db.get(Machine, raw_id):
                exists = True
            elif cat == "audit" and raw_id.isdigit() and db.get(AuditEvent, int(raw_id)):
                exists = True
            if exists:
                _deny_and_audit(
                    db,
                    user,
                    action_label="report_preview_or_download",
                    detail=f"Access denied: report '{report_uid}' is outside your assigned region scope.",
                    report_uid=report_uid,
                )
        raise HTTPException(status_code=404, detail=f"Report '{report_uid}' not found.")

    m_id = target.get("machine_id")
    related_abnormalities = []
    related_maintenance = []
    related_production = []
    latest_handover = None
    related_audit = []

    if m_id:
        related_abnormalities = [
            {
                "code": a.code,
                "title": a.title,
                "severity": a.severity,
                "status": a.status,
                "created_at": _to_utc(a.created_at).isoformat(),
            }
            for a in db.scalars(
                select(Abnormality).where(Abnormality.machine_id == m_id).order_by(desc(Abnormality.created_at)).limit(5)
            )
        ]
        related_maintenance = [
            {
                "type": m.maintenance_type,
                "summary": m.summary,
                "status": m.status,
                "engineer_name": m.engineer_name,
                "started_at": _to_utc(m.started_at).isoformat(),
            }
            for m in db.scalars(
                select(MaintenanceRecord)
                .where(MaintenanceRecord.machine_id == m_id)
                .order_by(desc(MaintenanceRecord.started_at))
                .limit(5)
            )
        ]
        related_production = [
            {
                "shift_name": p.shift_name,
                "units_produced": p.units_produced,
                "target_units": p.target_units,
                "reject_units": p.reject_units,
                "operator_name": p.operator_name,
                "recorded_at": _to_utc(p.recorded_at).isoformat(),
            }
            for p in db.scalars(
                select(ProductionEntry)
                .where(ProductionEntry.machine_id == m_id)
                .order_by(desc(ProductionEntry.recorded_at))
                .limit(5)
            )
        ]
        ho = db.scalar(
            select(HandoverRecord)
            .where(HandoverRecord.machine_id == m_id)
            .order_by(desc(HandoverRecord.created_at))
            .limit(1)
        )
        if ho:
            latest_handover = {
                "id": ho.id,
                "status": ho.status,
                "previous_shift": ho.previous_shift_name,
                "incoming_shift": ho.incoming_shift_name,
                "outgoing_operator": ho.outgoing_operator,
                "acknowledged_by": ho.acknowledged_by_name,
                "acknowledged_at": _to_utc(ho.acknowledged_at).isoformat() if ho.acknowledged_at else None,
            }
        related_audit = [
            {
                "action": ev.action,
                "actor_name": ev.actor_name,
                "details": ev.details,
                "created_at": _to_utc(ev.created_at).isoformat(),
            }
            for ev in db.scalars(
                select(AuditEvent).where(AuditEvent.machine_id == m_id).order_by(desc(AuditEvent.created_at)).limit(6)
            )
        ]

    return {
        "report": target,
        "context": {
            "production_records": related_production,
            "abnormalities": related_abnormalities,
            "maintenance_records": related_maintenance,
            "latest_handover": latest_handover,
            "audit_events": related_audit,
        },
    }


def render_individual_report_pdf_bytes(db: Session, user: UserAccount, report_uid: str) -> tuple[bytes, str, dict[str, Any]]:
    """Render an individual report as a full A4 ReportLab PDF (never blank)."""
    preview = build_report_preview_payload(db, user, report_uid)
    rep = preview["report"]
    ctx = preview["context"]

    # Reuse existing Handover PDF directly if available
    if rep["category"] == "shift_handover" and ":" in report_uid:
        ho_id = report_uid.split(":", 1)[1]
        ho = db.get(HandoverRecord, ho_id)
        if ho:
            if ho.pdf_filename:
                existing_path = Path(get_settings().output_dir) / ho.pdf_filename
                if existing_path.exists() and existing_path.stat().st_size > 0:
                    return existing_path.read_bytes(), ho.pdf_filename, rep
            if ho.grounded_report_json:
                pdf_path = publish_pdf(ho.grounded_report_json)
                ho.pdf_filename = pdf_path.name
                db.commit()
                return pdf_path.read_bytes(), pdf_path.name, rep

    buf = io.BytesIO()
    styles = getSampleStyleSheet()
    banner_title = ParagraphStyle("RT", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.white)
    banner_sub = ParagraphStyle("RS", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#DBEAFE"))
    h2 = ParagraphStyle("RH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10, textColor=colors.HexColor("#14213D"), spaceBefore=8, spaceAfter=4)
    th = ParagraphStyle("RTH", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.white)
    lbl = ParagraphStyle("RLB", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.HexColor("#475569"))
    cell = ParagraphStyle("RCL", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=colors.HexColor("#14213D"))

    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=34, leftMargin=34, topMargin=32, bottomMargin=44, title=rep["title"])
    story: list[Any] = []

    header = Table(
        [[
            [
                _p(f"PS-032 {rep['category_label'].upper()}", banner_title),
                _p(f"{rep['company_name']}  •  {rep['region_name']} / {rep['factory_name']} / {rep['line_name']}", banner_sub),
                _p(f"Asset: {rep['machine_code']} — {rep['machine_name']}", banner_sub),
            ],
            [
                _p(f"UID: {rep['report_uid']}", banner_sub),
                _p(f"Status: {rep['status'].upper()}", banner_sub),
                _p(f"Recorded: {rep['recorded_at'][:19]}Z", banner_sub),
            ],
        ]],
        colWidths=[355.0, 172.0],
    )
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1E3A8A")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.extend([header, Spacer(1, 10)])

    story.append(_p("1. REPORT & HIERARCHY METADATA", h2))
    meta_rows = [
        [_p("Report Title", lbl), _p(rep["title"], cell), _p("Category", lbl), _p(rep["category_label"], cell)],
        [_p("Company", lbl), _p(rep["company_name"], cell), _p("Region", lbl), _p(rep["region_name"], cell)],
        [_p("Factory", lbl), _p(rep["factory_name"], cell), _p("Production Line", lbl), _p(rep["line_name"], cell)],
        [_p("Machine Asset", lbl), _p(f"{rep['machine_code']} — {rep['machine_name']}", cell), _p("Shift", lbl), _p(rep["shift_name"], cell)],
        [_p("Operator / Actor", lbl), _p(rep["operator_or_actor"], cell), _p("Supervisor / Owner", lbl), _p(rep["supervisor_name"], cell)],
    ]
    meta_tbl = Table(meta_rows, colWidths=[92.0, 171.5, 92.0, 171.5])
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EAF2FC")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EAF2FC")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE6F2")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([meta_tbl, Spacer(1, 10)])

    story.append(_p("2. OPERATIONAL RECORD DETAILS", h2))
    detail_rows = [[_p("Field", th), _p("Recorded Value", th)], [_p("Summary", lbl), _p(rep["summary_line"], cell)]]
    for k, v in (rep.get("raw_details") or {}).items():
        if v is not None:
            detail_rows.append([_p(k.replace("_", " ").title(), lbl), _p(v, cell)])
    detail_tbl = Table(detail_rows, colWidths=[150.0, 377.0], repeatRows=1, splitByRow=1)
    detail_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F6FD")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE6F2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([detail_tbl, Spacer(1, 10)])

    # Related Context Section
    if ctx["abnormalities"] or ctx["maintenance_records"] or ctx["audit_events"]:
        story.append(_p("3. RELATED MACHINE ABNORMALITIES, MAINTENANCE & AUDIT TRAIL", h2))
        rel_rows = [[_p("Source", th), _p("Status", th), _p("Summary / Event Details", th)]]
        for a in ctx["abnormalities"]:
            rel_rows.append([_p(f"Abnormality {a['code']}", lbl), _p(a["status"].upper(), cell), _p(a["title"], cell)])
        for m in ctx["maintenance_records"]:
            rel_rows.append([_p(f"Maint ({m['type']})", lbl), _p(m["status"].upper(), cell), _p(m["summary"], cell)])
        for ev in ctx["audit_events"]:
            rel_rows.append([_p(f"Audit ({ev['action']})", lbl), _p(ev["actor_name"] or "System", cell), _p(ev["details"], cell)])
        rel_tbl = Table(rel_rows, colWidths=[125.0, 82.0, 320.0], repeatRows=1, splitByRow=1)
        rel_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#EAF2FC")]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE6F2")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(rel_tbl)

    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _NumberedFooterCanvas(
            *args,
            report_id=rep["report_uid"],
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            **kwargs,
        ),
    )
    filename = f"{_safe_filename(rep['machine_code'])}_{_safe_filename(rep['category'])}_{_safe_filename(rep['recorded_at'][:10])}.pdf"
    return buf.getvalue(), filename, rep


def render_bulk_reports_export(
    db: Session,
    user: UserAccount,
    *,
    scope: str,
    export_format: str = "pdf",
    region_id: Optional[str] = None,
    factory_id: Optional[str] = None,
    line_id: Optional[str] = None,
    machine_id: Optional[str] = None,
    category: Optional[str] = None,
    status: Optional[str] = None,
    shift_name: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> tuple[bytes, str, str, dict[str, Any]]:
    """Build consolidated Factory / Region / Company PDF or ZIP export with strict RBAC."""
    if scope not in ("company", "region", "factory"):
        raise HTTPException(status_code=400, detail="Invalid bulk download scope; expected factory, region, or company.")

    role = _enforce_centralized_report_scope(
        db,
        user,
        action_label=f"bulk_export_{scope}_{export_format}",
        scope=scope,
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
    )

    if scope == "region":
        if role == "regional_manager" and not region_id:
            region_id = user.assigned_region_id
        if not region_id:
            raise HTTPException(status_code=400, detail="Select a region for Region Report download.")
    elif scope == "factory":
        if not factory_id:
            raise HTTPException(status_code=400, detail="Select a factory for Factory Report download.")

    result = query_centralized_reports(
        db,
        user,
        region_id=region_id,
        factory_id=factory_id,
        line_id=line_id,
        machine_id=machine_id,
        category=category,
        status=status,
        shift_name=shift_name,
        start_date=start_date,
        end_date=end_date,
    )
    reports = result["reports"]
    if not reports:
        raise HTTPException(status_code=404, detail="No reports available for the selected filters.")

    summary = result["summary"]
    hmap = _load_hierarchy_maps(db)
    scope_label = (
        hmap["factories"][factory_id].name
        if scope == "factory" and factory_id in hmap["factories"]
        else hmap["regions"][region_id].name
        if scope == "region" and region_id in hmap["regions"]
        else hmap["company_name"]
    )
    cat_part = REPORT_CATEGORY_LABELS.get(category, "Shift_And_Operations").replace(" ", "_") if category else "Operations"
    date_part = (
        f"{start_date}_to_{end_date}"
        if start_date and end_date
        else start_date or end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    )
    base_name = _safe_filename(f"{scope_label}_{cat_part}_Reports_{date_part}")

    if export_format == "zip":
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, r in enumerate(reports[:60], start=1):
                pdf_bytes, fname, _ = render_individual_report_pdf_bytes(db, user, r["report_uid"])
                folder = _safe_filename(r["region_name"]) + "/" + _safe_filename(r["factory_name"])
                zf.writestr(f"{folder}/{idx:02d}_{fname}", pdf_bytes)
        return zbuf.getvalue(), f"{base_name}.zip", "application/zip", summary

    # Single Consolidated A4 ReportLab PDF
    pbuf = io.BytesIO()
    styles = getSampleStyleSheet()
    banner_title = ParagraphStyle("BT", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.white)
    banner_sub = ParagraphStyle("BS", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#DBEAFE"))
    h2 = ParagraphStyle("BH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, textColor=colors.HexColor("#14213D"), spaceBefore=10, spaceAfter=4, keepWithNext=True)
    h3 = ParagraphStyle("BH3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=9.5, textColor=colors.HexColor("#2563EB"), spaceBefore=6, spaceAfter=3, keepWithNext=True)
    th = ParagraphStyle("BTH", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5, textColor=colors.white)
    cell = ParagraphStyle("BC", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=10.5, textColor=colors.HexColor("#14213D"))

    doc = SimpleDocTemplate(pbuf, pagesize=A4, rightMargin=34, leftMargin=34, topMargin=32, bottomMargin=44, title=base_name)
    story: list[Any] = []
    date_label = f"{start_date or 'All Dates'} to {end_date or 'Present'}"
    cat_label = REPORT_CATEGORY_LABELS.get(category, "All Categories") if category else "All Categories"

    cover = Table(
        [[
            [
                _p(f"PS-032 CONSOLIDATED {scope.upper()} REPORTS", banner_title),
                _p(f"Scope: {scope_label}  |  Category: {cat_label}", banner_sub),
                _p(f"Date Window: {date_label}  |  Shift Filter: {shift_name or 'All Shifts'}", banner_sub),
            ],
            [
                _p(f"Exported By: {user.name}", banner_sub),
                _p(f"Role: {user.role}", banner_sub),
                _p(f"Total Reports: {summary['total_reports']}", banner_sub),
            ],
        ]],
        colWidths=[355.0, 172.0],
    )
    cover.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#14213D")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.extend([cover, Spacer(1, 8)])

    sum_tbl = Table(
        [
            [_p("Total Reports", th), _p("Pending Handovers", th), _p("Ack Handovers", th), _p("Open Abn.", th), _p("Maintenance", th), _p("Factories", th)],
            [_p(summary["total_reports"], cell), _p(summary["pending_handovers"], cell), _p(summary["acknowledged_handovers"], cell), _p(summary["open_abnormalities"], cell), _p(summary["maintenance_reports"], cell), _p(summary["factories_covered"], cell)],
        ],
        colWidths=[87.8] * 6,
    )
    sum_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2563EB")),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#EAF2FC")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE6F2")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([sum_tbl, Spacer(1, 10)])

    # Group by Region -> Factory
    by_region: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for r in reports:
        by_region.setdefault(r["region_name"], {}).setdefault(r["factory_name"], []).append(r)

    for reg_name, fac_map in by_region.items():
        story.append(_p(f"REGION: {reg_name.upper()}", h2))
        for fac_name, fac_reports in fac_map.items():
            story.append(_p(f"Factory: {fac_name} ({len(fac_reports)} reports)", h3))
            rows = [[
                _p("Category", th),
                _p("Machine / Line", th),
                _p("Shift", th),
                _p("Operator / Actor", th),
                _p("Status", th),
                _p("Key Metrics & Summary", th),
            ]]
            for item in fac_reports:
                rows.append([
                    _p(item["category_label"], cell),
                    _p(f"{item['machine_code']} ({item['line_name']})", cell),
                    _p(item["shift_name"], cell),
                    _p(item["operator_or_actor"], cell),
                    _p(item["status"].upper(), cell),
                    _p(item["summary_line"] or item["title"], cell),
                ])
            tbl = Table(rows, colWidths=[78.0, 92.0, 58.0, 68.0, 56.0, 175.0], repeatRows=1, splitByRow=1)
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F6FD")]),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DCE6F2")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.extend([tbl, Spacer(1, 8)])

    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#DCE6F2")))
    doc.build(
        story,
        canvasmaker=lambda *args, **kwargs: _NumberedFooterCanvas(
            *args,
            report_id=base_name,
            generated_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            **kwargs,
        ),
    )
    return pbuf.getvalue(), f"{base_name}.pdf", "application/pdf", summary
