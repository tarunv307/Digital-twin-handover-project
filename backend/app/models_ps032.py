"""PS-032 Phase 2 industrial operational & shift handover database models."""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from werkzeug.security import check_password_hash, generate_password_hash

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserAccount(Base):
    """Industrial personnel account adapted from Handover-note User."""

    __tablename__ = "ps032_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(140), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Industrial roles: company_admin, regional_manager, factory_supervisor, operator, maintenance_engineer
    role: Mapped[str] = mapped_column(String(40), nullable=False, default="operator")
    employee_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True, nullable=True, index=True)
    assigned_region_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    assigned_factory_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

    @property
    def legacy_role(self) -> str:
        """Backward-compatible Handover-note role alias."""
        if self.role in ("company_admin", "regional_manager", "factory_supervisor", "admin"):
            return "admin"
        return "employee"


class MachineTask(Base):
    """Production or machine task adapted from Handover-note Task."""

    __tablename__ = "ps032_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    task_type: Mapped[str] = mapped_column(String(40), default="production")  # production, maintenance, inspection, 5s
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)  # pending, submitted, completed
    machine_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_machines.id"), nullable=True, index=True)
    factory_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    shift_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    assigned_to: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    submission: Mapped[Optional["TaskSubmission"]] = relationship(
        back_populates="task", uselist=False, cascade="all, delete-orphan"
    )


class TaskSubmission(Base):
    """Work verification artifact adapted from Handover-note Submission."""

    __tablename__ = "ps032_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("ps032_tasks.id"), unique=True, nullable=False)
    submitted_by: Mapped[int] = mapped_column(ForeignKey("ps032_users.id"), nullable=False)
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    zip_path: Mapped[Optional[str]] = mapped_column(String(250), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    task: Mapped["MachineTask"] = relationship(back_populates="submission")


class ProductionEntry(Base):
    """Operator shift production & quality entry synced to machine OEE."""

    __tablename__ = "ps032_production_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    operator_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    units_produced: Mapped[int] = mapped_column(Integer, default=0)
    target_units: Mapped[int] = mapped_column(Integer, default=120)
    reject_units: Mapped[int] = mapped_column(Integer, default=0)
    downtime_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Abnormality(Base):
    """Machine abnormality / incident workflow replacing IT incidents."""

    __tablename__ = "ps032_abnormalities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(24), default="high")  # low, medium, high, critical
    status: Mapped[str] = mapped_column(String(24), default="open")  # open, investigating, resolved
    fault_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    reported_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    reported_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    assigned_to_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    assigned_to_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class MaintenanceRecord(Base):
    """Preventive & corrective machine maintenance records."""

    __tablename__ = "ps032_maintenance_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    maintenance_type: Mapped[str] = mapped_column(String(40), default="corrective")  # preventive, corrective, calibration
    status: Mapped[str] = mapped_column(String(24), default="scheduled")  # scheduled, in_progress, completed
    summary: Mapped[str] = mapped_column(String(220), nullable=False)
    inspection_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    parts_replaced: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    engineer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    engineer_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    abnormality_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_abnormalities.id"), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Cleaning5SLog(Base):
    """Cleaning, lubrication, and 5S safety observation checklist per machine/shift."""

    __tablename__ = "ps032_cleaning_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    area_cleaned: Mapped[bool] = mapped_column(Boolean, default=True)
    lubrication_checked: Mapped[bool] = mapped_column(Boolean, default=True)
    guards_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    safety_observations: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    logged_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    logged_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HandoverRecord(Base):
    """Machine-wise industrial shift handover report and incoming operator acknowledgement."""

    __tablename__ = "ps032_handover_records"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    line_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    previous_shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    incoming_shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    shift_window_label: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    outgoing_operator: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    incoming_operator: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    supervisor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    production_completed: Mapped[int] = mapped_column(Integer, default=0)
    production_target: Mapped[int] = mapped_column(Integer, default=0)
    machine_condition: Mapped[str] = mapped_column(String(40), default="Normal")
    downtime_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    pending_abnormalities_count: Mapped[int] = mapped_column(Integer, default=0)
    maintenance_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cleaning_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    safety_observations: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    operator_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    required_inspection: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    special_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    grounded_report_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    pdf_filename: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)

    # Acknowledgement workflow
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)  # pending, acknowledged
    acknowledged_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    acknowledged_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    acknowledgement_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AuditEvent(Base):
    """Immutable audit trail for compliance, handovers, faults, and RBAC actions."""

    __tablename__ = "ps032_audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actor_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    actor_role: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    action: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    machine_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    factory_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    region_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class OperatorAssignment(Base):
    """Normalized operator/engineer assignment to machine, line, factory, and shift."""

    __tablename__ = "ps032_operator_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("ps032_users.id"), index=True, nullable=False)
    machine_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=True)
    line_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_production_lines.id"), index=True, nullable=True)
    factory_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_factories.id"), index=True, nullable=True)
    shift_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_shift_schedules.id"), nullable=True)
    shift_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    assigned_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    assigned_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    start_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    end_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DowntimeEvent(Base):
    """Planned and unplanned machine downtime and loss analysis records."""

    __tablename__ = "ps032_downtime_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    line_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    category: Mapped[str] = mapped_column(String(24), default="unplanned")  # planned, unplanned
    reason_category: Mapped[str] = mapped_column(String(64), default="mechanical")
    reason_detail: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)  # open, closed
    reported_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    reported_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    closed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    closed_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SafetyChecklist(Base):
    """Start-of-shift digital machine safety inspection checklist."""

    __tablename__ = "ps032_safety_checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    items_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    overall_status: Mapped[str] = mapped_column(String(32), default="passed")  # passed, critical_fail, incomplete
    has_critical_failure: Mapped[bool] = mapped_column(Boolean, default=False)
    operator_remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    escalated_abnormality_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_abnormalities.id"), nullable=True)
    supervisor_review_status: Mapped[str] = mapped_column(String(24), default="pending")  # pending, reviewed, rejected
    supervisor_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    reviewed_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    submitted_by_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class MaintenanceSchedule(Base):
    """Preventive maintenance planner & recurring service schedules."""

    __tablename__ = "ps032_maintenance_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    maintenance_type: Mapped[str] = mapped_column(String(40), default="preventive")
    frequency_days: Mapped[int] = mapped_column(Integer, default=30)
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    next_service_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_engineer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    assigned_engineer_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    last_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="scheduled")  # scheduled, in_progress, completed
    linked_record_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_maintenance_records.id"), nullable=True)
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QualityInspection(Base):
    """Quality & defect management records connected to production & handovers."""

    __tablename__ = "ps032_quality_inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    production_entry_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_production_entries.id"), nullable=True)
    inspected_qty: Mapped[int] = mapped_column(Integer, default=0)
    rejected_qty: Mapped[int] = mapped_column(Integer, default=0)
    reworked_qty: Mapped[int] = mapped_column(Integer, default=0)
    defect_category: Mapped[str] = mapped_column(String(80), default="dimensional")
    remarks: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    inspector_id: Mapped[Optional[int]] = mapped_column(ForeignKey("ps032_users.id"), nullable=True)
    inspector_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    inspected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

