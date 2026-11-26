"""Database models for the Industrial Digital Twin hierarchy and telemetry."""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Company(Base):
    __tablename__ = "dt_companies"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    headquarters: Mapped[str] = mapped_column(String(160), nullable=False)
    industry_sector: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    latitude: Mapped[float] = mapped_column(Float, default=21.1458)
    longitude: Mapped[float] = mapped_column(Float, default=79.0882)

    regions: Mapped[list["Region"]] = relationship(back_populates="company", cascade="all, delete-orphan")


class Region(Base):
    __tablename__ = "dt_regions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("dt_companies.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    country: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    map_x: Mapped[float] = mapped_column(Float, default=0.0)
    map_z: Mapped[float] = mapped_column(Float, default=0.0)
    latitude: Mapped[float] = mapped_column(Float, default=20.5937)
    longitude: Mapped[float] = mapped_column(Float, default=78.9629)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship(back_populates="regions")
    factories: Mapped[list["Factory"]] = relationship(back_populates="region", cascade="all, delete-orphan")
    shift_schedules: Mapped[list["ShiftSchedule"]] = relationship(
        back_populates="region",
        foreign_keys="ShiftSchedule.region_id",
        cascade="all, delete-orphan",
    )


class Factory(Base):
    __tablename__ = "dt_factories"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    region_id: Mapped[str] = mapped_column(ForeignKey("dt_regions.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    facility_type: Mapped[str] = mapped_column(String(100), nullable=False)
    timezone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    floor_width_m: Mapped[float] = mapped_column(Float, default=90.0)
    floor_depth_m: Mapped[float] = mapped_column(Float, default=60.0)
    site_x: Mapped[float] = mapped_column(Float, default=0.0)
    site_z: Mapped[float] = mapped_column(Float, default=0.0)
    latitude: Mapped[float] = mapped_column(Float, default=11.0168)
    longitude: Mapped[float] = mapped_column(Float, default=76.9558)
    location_label: Mapped[str] = mapped_column(String(140), default="India")
    active_shift_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)

    region: Mapped["Region"] = relationship(back_populates="factories")
    production_lines: Mapped[list["ProductionLine"]] = relationship(
        back_populates="factory", cascade="all, delete-orphan"
    )
    shift_schedules: Mapped[list["ShiftSchedule"]] = relationship(
        back_populates="factory",
        foreign_keys="ShiftSchedule.factory_id",
        cascade="all, delete-orphan",
    )


class ProductionLine(Base):
    __tablename__ = "dt_production_lines"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    factory_id: Mapped[str] = mapped_column(ForeignKey("dt_factories.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    process_type: Mapped[str] = mapped_column(String(100), nullable=False)
    line_index: Mapped[int] = mapped_column(Integer, default=1)
    floor_offset_z: Mapped[float] = mapped_column(Float, default=0.0)
    target_oee: Mapped[float] = mapped_column(Float, default=85.0)

    factory: Mapped["Factory"] = relationship(back_populates="production_lines")
    machines: Mapped[list["Machine"]] = relationship(
        back_populates="production_line",
        order_by="Machine.sequence_order",
        cascade="all, delete-orphan",
    )


class Machine(Base):
    __tablename__ = "dt_machines"
    __table_args__ = (UniqueConstraint("line_id", "sequence_order", name="uq_line_sequence"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    line_id: Mapped[str] = mapped_column(ForeignKey("dt_production_lines.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    machine_type: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)
    pos_x: Mapped[float] = mapped_column(Float, default=0.0)
    pos_y: Mapped[float] = mapped_column(Float, default=0.0)
    pos_z: Mapped[float] = mapped_column(Float, default=0.0)
    rotation_y: Mapped[float] = mapped_column(Float, default=0.0)
    qr_token: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    external_machine_ref: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    production_line: Mapped["ProductionLine"] = relationship(back_populates="machines")
    specification: Mapped[Optional["MachineSpecification"]] = relationship(
        back_populates="machine", uselist=False, cascade="all, delete-orphan"
    )
    state: Mapped[Optional["MachineState"]] = relationship(
        back_populates="machine", uselist=False, cascade="all, delete-orphan"
    )
    events: Mapped[list["MachineEvent"]] = relationship(
        back_populates="machine", cascade="all, delete-orphan"
    )
    readings: Mapped[list["SensorReading"]] = relationship(
        back_populates="machine", cascade="all, delete-orphan"
    )


class MachineSpecification(Base):
    __tablename__ = "dt_machine_specifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), unique=True, nullable=False)
    manufacturer: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    serial_number: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    installation_date: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    rated_capacity_units_hr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    operating_parameters: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    supported_modes: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    connected_sensors: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    communication_protocol: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    operating_limits: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    maintenance_interval_hours: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_maintenance_date: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    responsible_department: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    machine: Mapped["Machine"] = relationship(back_populates="specification")


class MachineState(Base):
    __tablename__ = "dt_machine_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Idle")
    data_source: Mapped[str] = mapped_column(String(32), nullable=False, default="simulation")
    sensor_connectivity: Mapped[str] = mapped_column(String(32), nullable=False, default="connected")
    assigned_operator: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    production_count: Mapped[int] = mapped_column(Integer, default=0)
    production_target: Mapped[int] = mapped_column(Integer, default=120)
    temperature_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vibration_mm_s: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cycle_time_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    energy_kw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    downtime_min: Mapped[float] = mapped_column(Float, default=0.0)
    availability_pct: Mapped[float] = mapped_column(Float, default=0.0)
    performance_pct: Mapped[float] = mapped_column(Float, default=0.0)
    quality_pct: Mapped[float] = mapped_column(Float, default=99.0)
    oee_pct: Mapped[float] = mapped_column(Float, default=0.0)
    active_fault_code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    active_fault_message: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    handover_status: Mapped[str] = mapped_column(String(32), default="complete")
    last_sync_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    machine: Mapped["Machine"] = relationship(back_populates="state")


class SensorReading(Base):
    __tablename__ = "dt_sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    temperature_c: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vibration_mm_s: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cycle_time_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    energy_kw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    production_count: Mapped[int] = mapped_column(Integer, default=0)
    data_source: Mapped[str] = mapped_column(String(32), default="simulation")

    machine: Mapped["Machine"] = relationship(back_populates="readings")


class MachineEvent(Base):
    __tablename__ = "dt_machine_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    machine_id: Mapped[str] = mapped_column(ForeignKey("dt_machines.id"), index=True, nullable=False)
    factory_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    line_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    shift_name: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="info")
    previous_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    new_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    data_source: Mapped[str] = mapped_column(String(32), default="simulation")
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    machine: Mapped["Machine"] = relationship(back_populates="events")


class ShiftSchedule(Base):
    __tablename__ = "dt_shift_schedules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    region_id: Mapped[str] = mapped_column(ForeignKey("dt_regions.id"), nullable=False)
    factory_id: Mapped[Optional[str]] = mapped_column(ForeignKey("dt_factories.id"), nullable=True)
    shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    start_time: Mapped[str] = mapped_column(String(16), nullable=False)  # HH:MM
    end_time: Mapped[str] = mapped_column(String(16), nullable=False)    # HH:MM
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    supervisor: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    assigned_operators: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    handover_deadline_minutes: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    region: Mapped["Region"] = relationship(back_populates="shift_schedules", foreign_keys=[region_id])
    factory: Mapped[Optional["Factory"]] = relationship(back_populates="shift_schedules", foreign_keys=[factory_id])


class ShiftTransitionLog(Base):
    __tablename__ = "dt_shift_transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    factory_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    previous_shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    new_shift_name: Mapped[str] = mapped_column(String(80), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    machines_flagged_pending: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    transitioned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

