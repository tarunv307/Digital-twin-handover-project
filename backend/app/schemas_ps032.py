"""Pydantic schemas for PS-032 Phase 2 auth, operations, handovers, and audit trail."""

from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


IndustrialRole = Literal[
    "company_admin",
    "regional_manager",
    "factory_supervisor",
    "operator",
    "maintenance_engineer",
    "admin",
    "employee",
]


class UserDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    role: str
    employee_id: Optional[str] = None
    assigned_region_id: Optional[str] = None
    assigned_factory_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreateRequest(BaseModel):
    name: str
    email: str
    password: str
    role: IndustrialRole = "operator"
    employee_id: Optional[str] = None
    assigned_region_id: Optional[str] = None
    assigned_factory_id: Optional[str] = None


class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[IndustrialRole] = None
    employee_id: Optional[str] = None
    assigned_region_id: Optional[str] = None
    assigned_factory_id: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class TaskSubmissionDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    submitted_by: int
    link: Optional[str] = None
    zip_path: Optional[str] = None
    submitted_at: datetime
    admin_notes: Optional[str] = None


class MachineTaskDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: Optional[str] = None
    task_type: str
    status: str
    machine_id: Optional[str] = None
    factory_id: Optional[str] = None
    shift_name: Optional[str] = None
    assigned_to: Optional[int] = None
    created_by: Optional[int] = None
    created_at: datetime
    submission: Optional[TaskSubmissionDTO] = None


class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    task_type: str = "production"
    machine_id: Optional[str] = None
    factory_id: Optional[str] = None
    shift_name: Optional[str] = None
    assigned_to: Optional[int] = None


class ProductionEntryCreateRequest(BaseModel):
    machine_id: str
    shift_name: Optional[str] = None
    units_produced: int = Field(ge=0)
    target_units: Optional[int] = Field(default=None, ge=1)
    reject_units: int = Field(default=0, ge=0)
    downtime_minutes: float = Field(default=0.0, ge=0.0)
    remarks: Optional[str] = None


class ProductionEntryDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    factory_id: str
    region_id: str
    shift_name: str
    operator_id: Optional[int] = None
    operator_name: Optional[str] = None
    units_produced: int
    target_units: int
    reject_units: int
    downtime_minutes: float
    remarks: Optional[str] = None
    recorded_at: datetime


class AbnormalityCreateRequest(BaseModel):
    machine_id: str
    title: str
    description: str
    severity: Literal["low", "medium", "high", "critical"] = "high"
    fault_code: Optional[str] = None
    assigned_to_id: Optional[int] = None


class AbnormalityUpdateRequest(BaseModel):
    status: Optional[Literal["open", "investigating", "resolved"]] = None
    assigned_to_id: Optional[int] = None
    resolution_notes: Optional[str] = None


class AbnormalityDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    machine_id: str
    factory_id: str
    region_id: str
    shift_name: Optional[str] = None
    title: str
    description: str
    severity: str
    status: str
    fault_code: Optional[str] = None
    reported_by_id: Optional[int] = None
    reported_by_name: Optional[str] = None
    assigned_to_id: Optional[int] = None
    assigned_to_name: Optional[str] = None
    resolution_notes: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None


class MaintenanceCreateRequest(BaseModel):
    machine_id: str
    maintenance_type: Literal["preventive", "corrective", "calibration"] = "corrective"
    status: Literal["scheduled", "in_progress", "completed"] = "in_progress"
    summary: str
    inspection_notes: Optional[str] = None
    parts_replaced: Optional[str] = None
    abnormality_id: Optional[int] = None


class MaintenanceUpdateRequest(BaseModel):
    status: Optional[Literal["scheduled", "in_progress", "completed"]] = None
    inspection_notes: Optional[str] = None
    parts_replaced: Optional[str] = None


class MaintenanceRecordDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    factory_id: str
    maintenance_type: str
    status: str
    summary: str
    inspection_notes: Optional[str] = None
    parts_replaced: Optional[str] = None
    engineer_id: Optional[int] = None
    engineer_name: Optional[str] = None
    abnormality_id: Optional[int] = None
    started_at: datetime
    completed_at: Optional[datetime] = None


class Cleaning5SCreateRequest(BaseModel):
    machine_id: str
    shift_name: Optional[str] = None
    area_cleaned: bool = True
    lubrication_checked: bool = True
    guards_verified: bool = True
    safety_observations: Optional[str] = None


class Cleaning5SDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    shift_name: str
    area_cleaned: bool
    lubrication_checked: bool
    guards_verified: bool
    safety_observations: Optional[str] = None
    logged_by_id: Optional[int] = None
    logged_by_name: Optional[str] = None
    logged_at: datetime


class HandoverGenerateRequest(BaseModel):
    machine_id: str
    operator_remarks: Optional[str] = None
    maintenance_instructions: Optional[str] = None
    required_inspection: Optional[str] = None
    special_instructions: Optional[str] = None
    incoming_operator: Optional[str] = None


class HandoverAcknowledgeRequest(BaseModel):
    remarks: Optional[str] = None
    condition_confirmed: bool = True


class HandoverRecordDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    machine_id: str
    line_id: str
    factory_id: str
    region_id: str
    previous_shift_name: str
    incoming_shift_name: str
    shift_window_label: str
    timezone: str
    outgoing_operator: Optional[str] = None
    incoming_operator: Optional[str] = None
    supervisor_name: Optional[str] = None
    production_completed: int
    production_target: int
    machine_condition: str
    downtime_minutes: float
    pending_abnormalities_count: int
    maintenance_instructions: Optional[str] = None
    cleaning_summary: Optional[str] = None
    safety_observations: Optional[str] = None
    operator_remarks: Optional[str] = None
    required_inspection: Optional[str] = None
    special_instructions: Optional[str] = None
    grounded_report_json: Optional[dict[str, Any]] = None
    pdf_filename: Optional[str] = None
    status: str
    acknowledged_by_user_id: Optional[int] = None
    acknowledged_by_name: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    acknowledgement_remarks: Optional[str] = None
    created_at: datetime


class AuditEventDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    entity_type: str
    entity_id: str
    machine_id: Optional[str] = None
    factory_id: Optional[str] = None
    region_id: Optional[str] = None
    details: str
    metadata_json: Optional[dict[str, Any]] = None
    created_at: datetime


# -----------------------------------------------------------------------------
# Operator Machine & Shift Assignment Schemas
# -----------------------------------------------------------------------------
class OperatorAssignmentCreateRequest(BaseModel):
    user_id: int
    machine_id: Optional[str] = None
    line_id: Optional[str] = None
    factory_id: Optional[str] = None
    shift_id: Optional[str] = None
    shift_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_active: bool = True
    notes: Optional[str] = None


class OperatorAssignmentUpdateRequest(BaseModel):
    machine_id: Optional[str] = None
    line_id: Optional[str] = None
    factory_id: Optional[str] = None
    shift_id: Optional[str] = None
    shift_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class OperatorAssignmentDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    user_name: Optional[str] = None
    user_role: Optional[str] = None
    employee_id: Optional[str] = None
    machine_id: Optional[str] = None
    machine_code: Optional[str] = None
    machine_name: Optional[str] = None
    line_id: Optional[str] = None
    factory_id: Optional[str] = None
    shift_id: Optional[str] = None
    shift_name: Optional[str] = None
    assigned_by_id: Optional[int] = None
    assigned_by_name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_active: bool
    notes: Optional[str] = None
    created_at: datetime


# -----------------------------------------------------------------------------
# Downtime & Loss Analysis Schemas
# -----------------------------------------------------------------------------
class DowntimeCreateRequest(BaseModel):
    machine_id: str
    category: Literal["planned", "unplanned"] = "unplanned"
    reason_category: str = "mechanical"
    reason_detail: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_minutes: Optional[float] = Field(default=None, ge=0.0)


class DowntimeUpdateRequest(BaseModel):
    status: Optional[Literal["open", "closed"]] = None
    ended_at: Optional[datetime] = None
    duration_minutes: Optional[float] = Field(default=None, ge=0.0)
    reason_category: Optional[str] = None
    reason_detail: Optional[str] = None


class DowntimeEventDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    line_id: str
    factory_id: str
    region_id: str
    shift_name: str
    category: str
    reason_category: str
    reason_detail: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_minutes: float
    status: str
    reported_by_id: Optional[int] = None
    reported_by_name: Optional[str] = None
    closed_by_id: Optional[int] = None
    closed_by_name: Optional[str] = None
    created_at: datetime


# -----------------------------------------------------------------------------
# Digital Safety Checklist Schemas
# -----------------------------------------------------------------------------
class SafetyChecklistItemInput(BaseModel):
    key: str
    label: str
    response: Literal["pass", "fail", "na"] = "pass"
    critical: bool = False
    remark: Optional[str] = None


class SafetyChecklistCreateRequest(BaseModel):
    machine_id: str
    shift_name: Optional[str] = None
    items: list[SafetyChecklistItemInput]
    operator_remarks: Optional[str] = None


class SafetyChecklistReviewRequest(BaseModel):
    supervisor_review_status: Literal["reviewed", "rejected"]
    supervisor_notes: Optional[str] = None


class SafetyChecklistDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    factory_id: str
    shift_name: str
    items_json: list[dict[str, Any]]
    overall_status: str
    has_critical_failure: bool
    operator_remarks: Optional[str] = None
    escalated_abnormality_id: Optional[int] = None
    supervisor_review_status: str
    supervisor_notes: Optional[str] = None
    reviewed_by_id: Optional[int] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    submitted_by_id: Optional[int] = None
    submitted_by_name: Optional[str] = None
    submitted_at: datetime


# -----------------------------------------------------------------------------
# Preventive Maintenance Planner Schemas
# -----------------------------------------------------------------------------
class MaintenanceScheduleCreateRequest(BaseModel):
    machine_id: str
    title: str
    maintenance_type: Literal["preventive", "corrective", "calibration"] = "preventive"
    frequency_days: int = Field(default=30, ge=1, le=365)
    due_date: datetime
    assigned_engineer_id: Optional[int] = None


class MaintenanceScheduleUpdateRequest(BaseModel):
    status: Optional[Literal["scheduled", "in_progress", "completed"]] = None
    due_date: Optional[datetime] = None
    assigned_engineer_id: Optional[int] = None
    inspection_notes: Optional[str] = None
    parts_replaced: Optional[str] = None


class MaintenanceScheduleDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    machine_code: Optional[str] = None
    machine_name: Optional[str] = None
    factory_id: str
    title: str
    maintenance_type: str
    frequency_days: int
    due_date: datetime
    next_service_date: Optional[datetime] = None
    assigned_engineer_id: Optional[int] = None
    assigned_engineer_name: Optional[str] = None
    last_completed_at: Optional[datetime] = None
    status: str
    is_overdue: bool = False
    linked_record_id: Optional[int] = None
    created_at: datetime


# -----------------------------------------------------------------------------
# Quality & Defect Management Schemas
# -----------------------------------------------------------------------------
class QualityInspectionCreateRequest(BaseModel):
    machine_id: str
    shift_name: Optional[str] = None
    production_entry_id: Optional[int] = None
    inspected_qty: int = Field(ge=1)
    rejected_qty: int = Field(default=0, ge=0)
    reworked_qty: int = Field(default=0, ge=0)
    defect_category: str = "dimensional"
    remarks: Optional[str] = None


class QualityInspectionDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    factory_id: str
    shift_name: str
    production_entry_id: Optional[int] = None
    inspected_qty: int
    rejected_qty: int
    reworked_qty: int
    defect_category: str
    remarks: Optional[str] = None
    inspector_id: Optional[int] = None
    inspector_name: Optional[str] = None
    inspected_at: datetime

