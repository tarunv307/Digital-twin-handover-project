"""Seed initial PS-032 industrial users, abnormalities, maintenance, 5S, tasks, and handovers."""

from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MachineState
from app.models_ps032 import (
    Abnormality,
    AuditEvent,
    Cleaning5SLog,
    DowntimeEvent,
    HandoverRecord,
    MachineTask,
    MaintenanceRecord,
    MaintenanceSchedule,
    OperatorAssignment,
    ProductionEntry,
    QualityInspection,
    SafetyChecklist,
    TaskSubmission,
    UserAccount,
)
from app.services.handover_pipeline import generate_handover_note, publish_pdf


def seed_ps032_if_empty(db: Session) -> None:
    """Populate industrial personnel, operational logs, and Handover-note compatible demo users."""
    existing = db.scalar(select(UserAccount.id).limit(1))
    if existing is not None:
        return

    users = [
        # Industrial roles + preserved Handover-note demo accounts
        UserAccount(
            name="R. Sundaram (Company Admin)",
            email="admin@example.com",
            role="company_admin",
            employee_id="ADM-001",
        ),
        UserAccount(
            name="V. Lakshmi (Regional Manager - South Region)",
            email="regional@example.com",
            role="regional_manager",
            employee_id="REG-101",
            assigned_region_id="reg-south-india",
        ),
        UserAccount(
            name="S. Karthik (Coimbatore Plant Supervisor)",
            email="supervisor@example.com",
            role="factory_supervisor",
            employee_id="SUP-201",
            assigned_region_id="reg-south-india",
            assigned_factory_id="fac-chn-a",
        ),
        UserAccount(
            name="M. Priya (Incoming Shift Operator)",
            email="operator@example.com",
            role="operator",
            employee_id="OPR-301",
            assigned_region_id="reg-south-india",
            assigned_factory_id="fac-chn-a",
        ),
        UserAccount(
            name="K. Aravind (Outgoing Shift Operator)",
            email="john@example.com",
            role="operator",
            employee_id="EMP-101",
            assigned_region_id="reg-south-india",
            assigned_factory_id="fac-chn-a",
        ),
        UserAccount(
            name="D. Ramesh (Maintenance Engineer)",
            email="maintenance@example.com",
            role="maintenance_engineer",
            employee_id="MNT-401",
            assigned_region_id="reg-south-india",
            assigned_factory_id="fac-chn-a",
        ),
    ]
    passwords = ["admin123", "regional123", "supervisor123", "operator123", "employee123", "maint123"]
    for u, pwd in zip(users, passwords):
        u.set_password(pwd)
    db.add_all(users)
    db.flush()

    admin_u, _, sup_u, op_in, op_out, maint_u = users
    now = datetime.now(timezone.utc)

    # Industrial Abnormalities
    abn1 = Abnormality(
        code="ABN-2026-001",
        machine_id="mch-hsr-303",
        factory_id="fac-hsr-b",
        region_id="reg-south-india",
        shift_name="Morning Shift",
        title="Hydraulic cushion pressure drop & high vibration",
        description="Die cushion pressure dropped below 140 bar during progressive trim stroke; tri-axial vibration reached 6.8 mm/s.",
        severity="critical",
        status="investigating",
        fault_code="E-309",
        reported_by_id=op_out.id,
        reported_by_name=op_out.name,
        assigned_to_id=maint_u.id,
        assigned_to_name=maint_u.name,
        created_at=now - timedelta(minutes=25),
    )
    abn2 = Abnormality(
        code="ABN-2026-002",
        machine_id="mch-chn-103",
        factory_id="fac-chn-a",
        region_id="reg-south-india",
        shift_name="Morning Shift",
        title="Minor coolant nozzle misting drift",
        description="Secondary boring coolant nozzle pressure fluctuated +/- 1.5 bar; requires filter check at shift handover.",
        severity="medium",
        status="open",
        fault_code="W-114",
        reported_by_id=op_out.id,
        reported_by_name=op_out.name,
        assigned_to_id=maint_u.id,
        assigned_to_name=maint_u.name,
        created_at=now - timedelta(minutes=40),
    )
    db.add_all([abn1, abn2])
    db.flush()

    # Maintenance Records
    mnt1 = MaintenanceRecord(
        machine_id="mch-chn-202",
        factory_id="fac-chn-a",
        maintenance_type="preventive",
        status="in_progress",
        summary="Copper hairpin inserter guide rail alignment & torque calibration",
        inspection_notes="Replaced worn guide bushing on head #2; verifying stroke repeatability.",
        parts_replaced="Guide Bushing GB-42",
        engineer_id=maint_u.id,
        engineer_name=maint_u.name,
        started_at=now - timedelta(minutes=30),
    )
    mnt2 = MaintenanceRecord(
        machine_id="mch-chn-103",
        factory_id="fac-chn-a",
        maintenance_type="corrective",
        status="completed",
        summary="Spindle taper cleaning and drawbar clamping force check",
        inspection_notes="Clamping force measured at 11.8 kN (within spec).",
        engineer_id=maint_u.id,
        engineer_name=maint_u.name,
        started_at=now - timedelta(hours=5),
        completed_at=now - timedelta(hours=4),
    )
    db.add_all([mnt1, mnt2])

    # Production Entries & Cleaning/5S
    db.add_all(
        [
            ProductionEntry(
                machine_id="mch-chn-103",
                factory_id="fac-chn-a",
                region_id="reg-south-india",
                shift_name="Morning Shift",
                operator_id=op_out.id,
                operator_name=op_out.name,
                units_produced=138,
                target_units=160,
                reject_units=1,
                downtime_minutes=4.0,
                remarks="Steady bore tolerance (H7); minor coolant pressure fluctuation noted.",
            ),
            Cleaning5SLog(
                machine_id="mch-chn-103",
                shift_name="Morning Shift",
                area_cleaned=True,
                lubrication_checked=True,
                guards_verified=True,
                safety_observations="Chip tray cleared, interlock doors verified.",
                logged_by_id=op_out.id,
                logged_by_name=op_out.name,
            ),
        ]
    )

    # Industrial Tasks (preserving Handover-note Task + Submission workflow)
    t1 = MachineTask(
        title="Verify Bore Diameter SPC Chart on MCH-103",
        description="Record 5-piece CMM confirmation sample after tool insert index.",
        task_type="inspection",
        status="completed",
        machine_id="mch-chn-103",
        factory_id="fac-chn-a",
        shift_name="Morning Shift",
        assigned_to=op_out.id,
        created_by=sup_u.id,
    )
    t2 = MachineTask(
        title="Inspect Coolant Filter Differential on MCH-103",
        description="Verify secondary coolant line pressure and replace cartridge if delta-P > 1.8 bar.",
        task_type="maintenance",
        status="pending",
        machine_id="mch-chn-103",
        factory_id="fac-chn-a",
        shift_name="Evening Shift",
        assigned_to=op_in.id,
        created_by=sup_u.id,
    )
    db.add_all([t1, t2])
    db.flush()
    db.add(
        TaskSubmission(
            task_id=t1.id,
            submitted_by=op_out.id,
            link="https://internal.apex-mfg.local/spc/MCH-103-batch-44",
            admin_notes="Verified Cpk = 1.68; approved by Factory Supervisor.",
        )
    )

    # Pending Shift Handover for MCH-103 (aligned with Phase 1 seed handover_status='pending')
    ho_id = "HO-CHN-103-INITIAL"
    grounded = generate_handover_note(
        [
            {
                "source": "production",
                "record_id": "PROD-103",
                "status": "completed",
                "assignee": op_out.name,
                "summary": "Completed 138/160 units (1 reject, 4.0 min downtime)",
                "timestamp": now.isoformat(),
                "timestamp_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            {
                "source": "abnormality",
                "record_id": abn2.code,
                "status": "open",
                "severity": "medium",
                "assignee": maint_u.name,
                "summary": abn2.title,
                "timestamp": now.isoformat(),
                "timestamp_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            {
                "source": "cleaning_5s",
                "record_id": "5S-103",
                "status": "chat",
                "summary": "5S Verified: Area cleaned, lubrication & safety guards checked.",
                "timestamp": now.isoformat(),
                "timestamp_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        ],
        meta={
            "report_id": ho_id,
            "machine_label": "MCH-103 — Machine 03 — Precision Bore Center",
            "shift_start_local": "06:00",
            "shift_end_local": "14:00",
            "timezone": "Asia/Kolkata",
        },
    )
    grounded["industrial_context"] = {
        "company_name": "Apex Precision Manufacturing",
        "region_name": "South Region",
        "factory_name": "Coimbatore Precision Works",
        "line_name": "Production Line 01 — Powertrain CNC",
        "machine_id": "mch-chn-103",
        "machine_code": "MCH-103",
        "machine_name": "Machine 03 — Precision Bore Center",
        "machine_info": {
            "machine_condition": "Running",
            "handover_status": "pending",
            "outgoing_operator": op_out.name,
            "incoming_operator": op_in.name,
            "supervisor_name": sup_u.name,
            "previous_shift_name": "Morning Shift",
            "incoming_shift_name": "Evening Shift",
            "production_completed": 138,
            "production_target": 160,
            "reject_units": 1,
            "downtime_minutes": 4.0,
            "oee_pct": 86.1,
            "temperature_c": 59.1,
            "vibration_mm_s": 2.1,
            "energy_kw": 29.4,
            "cycle_time_sec": 27.0,
            "data_source": "simulation",
        },
        "abnormalities": [
            {
                "code": abn2.code,
                "title": abn2.title,
                "description": abn2.description,
                "severity": abn2.severity,
                "status": abn2.status,
                "assigned_to_name": abn2.assigned_to_name,
                "resolution_notes": None,
                "created_at": abn2.created_at.strftime("%Y-%m-%d %H:%M UTC"),
            }
        ],
        "maintenance_records": [
            {
                "maintenance_type": "corrective",
                "summary": "Spindle taper cleaning and drawbar clamping force check",
                "status": "completed",
                "engineer_name": maint_u.name,
                "parts_replaced": None,
                "inspection_notes": "Clamping force measured at 11.8 kN (within spec).",
            }
        ],
        "cleaning_5s": {
            "area_cleaned": True,
            "lubrication_checked": True,
            "guards_verified": True,
            "safety_observations": "Chip tray cleared, interlock doors verified.",
            "logged_by_name": op_out.name,
            "logged_at": now.strftime("%Y-%m-%d %H:%M UTC"),
        },
        "handover_notes": {
            "operator_remarks": "Machine running smoothly at 59.1C; handover ready for incoming operator.",
            "maintenance_instructions": "Monitor secondary coolant pressure; inspect ABN-2026-002 during setup.",
            "required_inspection": "Verify coolant line gauge before starting batch #45.",
            "special_instructions": "Do not exceed 4,500 RPM until coolant cartridge check is complete.",
            "safety_observations": "Interlock doors verified; zero safety hazards.",
        },
        "acknowledgement": {"status": "pending"},
    }
    pdf_path = publish_pdf(grounded)

    ho = HandoverRecord(
        id=ho_id,
        machine_id="mch-chn-103",
        line_id="line-chn-01",
        factory_id="fac-chn-a",
        region_id="reg-south-india",
        previous_shift_name="Morning Shift",
        incoming_shift_name="Evening Shift",
        shift_window_label="06:00 - 14:00",
        timezone="Asia/Kolkata",
        outgoing_operator=op_out.name,
        incoming_operator=op_in.name,
        supervisor_name=sup_u.name,
        production_completed=138,
        production_target=160,
        machine_condition="Running (Watch coolant pressure)",
        downtime_minutes=4.0,
        pending_abnormalities_count=1,
        maintenance_instructions="Monitor secondary coolant pressure; inspect ABN-2026-002 during setup.",
        cleaning_summary="Area cleaned, lubrication checked, guards verified.",
        safety_observations="Interlock doors verified; zero safety hazards.",
        operator_remarks="Machine running smoothly at 59.1C; handover ready for incoming operator.",
        required_inspection="Verify coolant line gauge before starting batch #45.",
        special_instructions="Do not exceed 4,500 RPM until coolant cartridge check is complete.",
        grounded_report_json=grounded,
        pdf_filename=pdf_path.name,
        status="pending",
    )
    db.add(ho)

    # Ensure MCH-103 state matches pending handover
    m103_state = db.scalar(select(MachineState).where(MachineState.machine_id == "mch-chn-103"))
    if m103_state:
        m103_state.handover_status = "pending"

    db.add(
        AuditEvent(
            actor_user_id=admin_u.id,
            actor_name=admin_u.name,
            actor_role=admin_u.role,
            action="system_seed",
            entity_type="handover",
            entity_id=ho_id,
            machine_id="mch-chn-103",
            factory_id="fac-chn-a",
            region_id="reg-south-india",
            details="Initialized PS-032 industrial operational records and pending shift handover HO-CHN-103-INITIAL.",
        )
    )

    # Seed normalized Operator-to-Machine & Maintenance Engineer assignments
    db.add_all(
        [
            OperatorAssignment(
                user_id=op_out.id,
                machine_id="mch-chn-103",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                shift_id="sh-ind-morning",
                shift_name="Morning Shift",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
                notes="Primary precision bore station assignment",
            ),
            OperatorAssignment(
                user_id=op_out.id,
                machine_id="mch-chn-101",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                shift_id="sh-ind-morning",
                shift_name="Morning Shift",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
            ),
            OperatorAssignment(
                user_id=op_out.id,
                machine_id="mch-str-401",
                line_id="line-str-01",
                factory_id="fac-str-c",
                shift_id="sh-emea-night",
                shift_name="Nachtschicht (Night)",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
            ),
            OperatorAssignment(
                user_id=op_in.id,
                machine_id="mch-chn-103",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                shift_id="sh-ind-evening",
                shift_name="Evening Shift",
                assigned_by_id=sup_u.id,
                assigned_by_name=sup_u.name,
                notes="Incoming shift operator for MCH-103",
            ),
            OperatorAssignment(
                user_id=op_in.id,
                machine_id="mch-chn-101",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                shift_id="sh-ind-evening",
                shift_name="Evening Shift",
                assigned_by_id=sup_u.id,
                assigned_by_name=sup_u.name,
            ),
            OperatorAssignment(
                user_id=maint_u.id,
                machine_id="mch-chn-103",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
            ),
            OperatorAssignment(
                user_id=maint_u.id,
                machine_id="mch-chn-202",
                line_id="line-chn-02",
                factory_id="fac-chn-a",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
            ),
            OperatorAssignment(
                user_id=maint_u.id,
                machine_id="mch-hsr-303",
                line_id="line-hsr-01",
                factory_id="fac-hsr-b",
                assigned_by_id=admin_u.id,
                assigned_by_name=admin_u.name,
            ),
        ]
    )

    # Seed Downtime, Safety Checklist, Maintenance Schedules & Quality Inspections
    db.add_all(
        [
            DowntimeEvent(
                machine_id="mch-chn-103",
                line_id="line-chn-01",
                factory_id="fac-chn-a",
                region_id="reg-south-india",
                shift_name="Morning Shift",
                category="planned",
                reason_category="tooling",
                reason_detail="Scheduled boring bar insert index & offset calibration",
                started_at=now - timedelta(hours=2),
                ended_at=now - timedelta(hours=1, minutes=56),
                duration_minutes=4.0,
                status="closed",
                reported_by_id=op_out.id,
                reported_by_name=op_out.name,
                closed_by_id=op_out.id,
                closed_by_name=op_out.name,
            ),
            DowntimeEvent(
                machine_id="mch-hsr-303",
                line_id="line-hsr-01",
                factory_id="fac-hsr-b",
                region_id="reg-south-india",
                shift_name="Morning Shift",
                category="unplanned",
                reason_category="mechanical",
                reason_detail="Hydraulic die cushion pressure drop (E-309)",
                started_at=now - timedelta(minutes=25),
                duration_minutes=22.0,
                status="open",
                reported_by_id=op_out.id,
                reported_by_name=op_out.name,
            ),
            SafetyChecklist(
                machine_id="mch-chn-103",
                factory_id="fac-chn-a",
                shift_name="Morning Shift",
                items_json=[
                    {"key": "e_stop", "label": "Emergency Stop & Guard Interlocks Verified", "response": "pass", "critical": True, "remark": "Tested before cycle"},
                    {"key": "coolant_leaks", "label": "No Coolant or Hydraulic Pressure Leaks", "response": "pass", "critical": True, "remark": "Clean"},
                    {"key": "ppe_area", "label": "Operator PPE & Chip Guard Clear", "response": "pass", "critical": False, "remark": ""},
                ],
                overall_status="passed",
                has_critical_failure=False,
                operator_remarks="Start-of-shift safety verification complete.",
                supervisor_review_status="reviewed",
                supervisor_notes="Approved by factory supervisor.",
                reviewed_by_id=sup_u.id,
                reviewed_by_name=sup_u.name,
                reviewed_at=now - timedelta(hours=3),
                submitted_by_id=op_out.id,
                submitted_by_name=op_out.name,
            ),
            MaintenanceSchedule(
                machine_id="mch-chn-103",
                factory_id="fac-chn-a",
                title="500-Hr Spindle Bearing & Coolant Filter PM",
                maintenance_type="preventive",
                frequency_days=30,
                due_date=now + timedelta(days=6),
                next_service_date=now + timedelta(days=36),
                assigned_engineer_id=maint_u.id,
                assigned_engineer_name=maint_u.name,
                status="scheduled",
                created_by_id=sup_u.id,
            ),
            MaintenanceSchedule(
                machine_id="mch-hsr-303",
                factory_id="fac-hsr-b",
                title="Hydraulic Cushion Seal & Valve Overhaul",
                maintenance_type="preventive",
                frequency_days=14,
                due_date=now - timedelta(days=2),  # Overdue sample
                next_service_date=now + timedelta(days=12),
                assigned_engineer_id=maint_u.id,
                assigned_engineer_name=maint_u.name,
                status="scheduled",
                created_by_id=admin_u.id,
            ),
            QualityInspection(
                machine_id="mch-chn-103",
                factory_id="fac-chn-a",
                shift_name="Morning Shift",
                inspected_qty=138,
                rejected_qty=1,
                reworked_qty=1,
                defect_category="surface_finish",
                remarks="1 housing reworked for minor chamfer burr; rest within H7 bore spec.",
                inspector_id=op_out.id,
                inspector_name=op_out.name,
            ),
        ]
    )
    db.commit()

