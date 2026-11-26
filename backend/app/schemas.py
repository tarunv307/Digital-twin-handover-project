"""Pydantic schemas for the Digital Twin API and WebSocket payloads."""

from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


MachineStatusLiteral = Literal[
    "Running",
    "Idle",
    "Stopped",
    "Fault",
    "Maintenance",
    "Offline",
    "Unknown",
]


class OperationalSummaryDTO(BaseModel):
    total_regions: int = 0
    total_factories: int = 0
    total_lines: int = 0
    total_machines: int = 0
    running_machines: int = 0
    idle_machines: int = 0
    stopped_machines: int = 0
    faulted_machines: int = 0
    maintenance_machines: int = 0
    offline_machines: int = 0
    total_production: int = 0
    total_target: int = 0
    overall_oee: float = 0.0
    pending_handovers: int = 0
    active_abnormalities: int = 0
    open_maintenance_orders: int = 0
    overdue_maintenance_orders: int = 0


class ShiftWindowDTO(BaseModel):
    schedule_id: str
    shift_name: str
    start_time: str
    end_time: str
    timezone: str
    crosses_midnight: bool
    duration_hours: float
    supervisor: Optional[str] = None
    assigned_operators: list[str] = Field(default_factory=list)
    handover_deadline_minutes: int = 30


class ShiftContextDTO(BaseModel):
    timezone: str
    local_time_iso: str
    current_shift: Optional[ShiftWindowDTO] = None
    previous_shift: Optional[ShiftWindowDTO] = None
    upcoming_shift: Optional[ShiftWindowDTO] = None
    minutes_to_transition: Optional[int] = None
    handover_pending_count: int = 0
    schedules: list[ShiftWindowDTO] = Field(default_factory=list)


class ShiftScheduleCreateDTO(BaseModel):
    region_id: str
    factory_id: Optional[str] = None
    shift_name: str
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    timezone: str
    supervisor: Optional[str] = None
    assigned_operators: list[str] = Field(default_factory=list)
    handover_deadline_minutes: int = 30


class ShiftScheduleUpdateDTO(BaseModel):
    shift_name: Optional[str] = None
    start_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    timezone: Optional[str] = None
    supervisor: Optional[str] = None
    assigned_operators: Optional[list[str]] = None
    handover_deadline_minutes: Optional[int] = None
    is_active: Optional[bool] = None


class MachineSpecificationDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    category: Optional[str] = None
    installation_date: Optional[str] = None
    rated_capacity_units_hr: Optional[float] = None
    operating_parameters: Optional[dict[str, Any]] = None
    supported_modes: Optional[list[str]] = None
    connected_sensors: Optional[list[dict[str, Any]]] = None
    communication_protocol: Optional[str] = None
    operating_limits: Optional[dict[str, Any]] = None
    maintenance_interval_hours: Optional[int] = None
    last_maintenance_date: Optional[str] = None
    responsible_department: Optional[str] = None


class MachineStateDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    data_source: str
    sensor_connectivity: str
    assigned_operator: Optional[str] = None
    production_count: int
    production_target: int
    temperature_c: Optional[float] = None
    vibration_mm_s: Optional[float] = None
    cycle_time_sec: Optional[float] = None
    energy_kw: Optional[float] = None
    downtime_min: float
    availability_pct: float
    performance_pct: float
    quality_pct: float
    oee_pct: float
    active_fault_code: Optional[str] = None
    active_fault_message: Optional[str] = None
    handover_status: str
    last_sync_at: datetime
    is_stale: bool = False


class SensorReadingDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    timestamp: datetime
    status: str
    temperature_c: Optional[float] = None
    vibration_mm_s: Optional[float] = None
    cycle_time_sec: Optional[float] = None
    energy_kw: Optional[float] = None
    production_count: int
    data_source: str


class MachineEventDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    machine_id: str
    factory_id: str
    region_id: str
    line_id: str
    shift_name: Optional[str] = None
    event_type: str
    severity: str
    previous_status: Optional[str] = None
    new_status: Optional[str] = None
    message: str
    data_source: str
    metadata_json: Optional[dict[str, Any]] = None
    timestamp: datetime


class HandoverHookDTO(BaseModel):
    """Phase 2 integration placeholder for PS-032 shift handover records."""

    integration_phase: str = "phase1_stub"
    handover_status: str
    previous_shift_name: Optional[str] = None
    current_shift_name: Optional[str] = None
    message: str


class MachineSummaryDTO(BaseModel):
    id: str
    line_id: str
    name: str
    code: str
    machine_type: str
    sequence_order: int
    pos_x: float
    pos_y: float
    pos_z: float
    rotation_y: float
    qr_token: str
    state: Optional[MachineStateDTO] = None


class MachineDetailDTO(MachineSummaryDTO):
    factory_id: str
    factory_name: str
    region_id: str
    region_name: str
    line_name: str
    specification: Optional[MachineSpecificationDTO] = None
    recent_readings: list[SensorReadingDTO] = Field(default_factory=list)
    recent_events: list[MachineEventDTO] = Field(default_factory=list)
    shift_context: Optional[ShiftContextDTO] = None
    handover_hook: Optional[HandoverHookDTO] = None


class ProductionLineSummaryDTO(BaseModel):
    id: str
    factory_id: str
    name: str
    code: str
    process_type: str
    line_index: int
    floor_offset_z: float
    target_oee: float
    summary: OperationalSummaryDTO
    machines: list[MachineSummaryDTO] = Field(default_factory=list)


class ProductionLineDetailDTO(ProductionLineSummaryDTO):
    factory_name: str
    region_id: str
    region_name: str
    shift_context: ShiftContextDTO


class FactorySummaryDTO(BaseModel):
    id: str
    region_id: str
    name: str
    code: str
    facility_type: str
    timezone: Optional[str] = None
    floor_width_m: float
    floor_depth_m: float
    site_x: float
    site_z: float
    latitude: float = 11.0168
    longitude: float = 76.9558
    location_label: str = "India"
    active_shift_name: Optional[str] = None
    summary: OperationalSummaryDTO
    shift_context: ShiftContextDTO


class FactoryDetailDTO(FactorySummaryDTO):
    region_name: str
    production_lines: list[ProductionLineSummaryDTO] = Field(default_factory=list)


class RegionSummaryDTO(BaseModel):
    id: str
    company_id: str
    name: str
    code: str
    country: str
    timezone: str
    map_x: float
    map_z: float
    latitude: float = 20.5937
    longitude: float = 78.9629
    description: Optional[str] = None
    summary: OperationalSummaryDTO
    shift_context: ShiftContextDTO


class RegionDetailDTO(RegionSummaryDTO):
    company_name: str
    factories: list[FactorySummaryDTO] = Field(default_factory=list)


class CompanyOverviewDTO(BaseModel):
    id: str
    name: str
    code: str
    headquarters: str
    industry_sector: str
    description: Optional[str] = None
    latitude: float = 21.1458
    longitude: float = 79.0882
    summary: OperationalSummaryDTO
    regions: list[RegionDetailDTO] = Field(default_factory=list)


class FactoryTreeDTO(FactorySummaryDTO):
    production_lines: list[ProductionLineSummaryDTO] = Field(default_factory=list)


class RegionTreeDTO(RegionSummaryDTO):
    company_name: str
    factories: list[FactoryTreeDTO] = Field(default_factory=list)


class CompanyHierarchyDTO(BaseModel):
    id: str
    name: str
    code: str
    headquarters: str
    industry_sector: str
    description: Optional[str] = None
    latitude: float = 21.1458
    longitude: float = 79.0882
    summary: OperationalSummaryDTO
    regions: list[RegionTreeDTO] = Field(default_factory=list)


class TelemetryIngestItem(BaseModel):
    machine_id: str
    status: Optional[MachineStatusLiteral] = None
    temperature_c: Optional[float] = None
    vibration_mm_s: Optional[float] = None
    cycle_time_sec: Optional[float] = None
    energy_kw: Optional[float] = None
    production_delta: int = 0
    production_count: Optional[int] = None
    downtime_delta_min: float = 0.0
    fault_code: Optional[str] = None
    fault_message: Optional[str] = None
    data_source: str = "simulation"
    sensor_connectivity: str = "connected"
    event_type: Optional[str] = None
    event_message: Optional[str] = None


class TelemetryBatchRequest(BaseModel):
    items: list[TelemetryIngestItem]


class SimulationCommandRequest(BaseModel):
    machine_id: Optional[str] = None
    fault_code: Optional[str] = "E-402"
    fault_message: Optional[str] = "Spindle thermal overload / vibration limit exceeded"
    target_status: Optional[MachineStatusLiteral] = None
    region_id: Optional[str] = None
    factory_id: Optional[str] = None
    at_iso: Optional[str] = None


class SimulationStatusDTO(BaseModel):
    state: Literal["running", "paused", "stopped"] = "stopped"
    running: bool
    paused: bool = False
    interval_sec: float
    mode: str = "simulation"
    simulated_machines_count: int = 0
    ticks_emitted: int = 0
    last_tick_at: Optional[datetime] = None


class SimulationIntervalRequest(BaseModel):
    interval_sec: float = Field(ge=0.5, le=30.0)

