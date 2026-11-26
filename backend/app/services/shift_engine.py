"""Timezone-aware regional and factory shift schedule engine."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Factory, Machine, MachineEvent, MachineState, ProductionLine, Region, ShiftSchedule, ShiftTransitionLog
from app.schemas import ShiftContextDTO, ShiftWindowDTO


def _parse_hhmm(value: str) -> int:
    hours, minutes = map(int, value.split(":"))
    return hours * 60 + minutes


def _duration_hours(start_min: int, end_min: int) -> float:
    diff = end_min - start_min
    if diff <= 0:
        diff += 24 * 60
    return round(diff / 60.0, 2)


def _to_window_dto(schedule: ShiftSchedule) -> ShiftWindowDTO:
    start_m = _parse_hhmm(schedule.start_time)
    end_m = _parse_hhmm(schedule.end_time)
    return ShiftWindowDTO(
        schedule_id=schedule.id,
        shift_name=schedule.shift_name,
        start_time=schedule.start_time,
        end_time=schedule.end_time,
        timezone=schedule.timezone,
        crosses_midnight=end_m <= start_m,
        duration_hours=_duration_hours(start_m, end_m),
        supervisor=schedule.supervisor,
        assigned_operators=list(schedule.assigned_operators or []),
        handover_deadline_minutes=schedule.handover_deadline_minutes,
    )


def _matches_minute(minute_of_day: int, start_m: int, end_m: int) -> bool:
    if end_m > start_m:
        return start_m <= minute_of_day < end_m
    # Crosses midnight, e.g. 22:00 (1320) -> 06:00 (360)
    return minute_of_day >= start_m or minute_of_day < end_m


def _minutes_until(minute_of_day: int, target_m: int) -> int:
    diff = target_m - minute_of_day
    if diff <= 0:
        diff += 24 * 60
    return diff


def get_effective_schedules(
    db: Session,
    region_id: str,
    factory_id: str | None = None,
) -> tuple[str, list[ShiftSchedule]]:
    """Return (timezone_str, active ShiftSchedule list) preferring factory overrides."""
    tz_name = "UTC"
    region = db.get(Region, region_id)
    if region and region.timezone:
        tz_name = region.timezone

    if factory_id:
        factory = db.get(Factory, factory_id)
        if factory and factory.timezone:
            tz_name = factory.timezone
        factory_schedules = list(
            db.scalars(
                select(ShiftSchedule)
                .where(
                    ShiftSchedule.factory_id == factory_id,
                    ShiftSchedule.is_active.is_(True),
                )
            )
        )
        if factory_schedules:
            factory_schedules.sort(key=lambda s: _parse_hhmm(s.start_time))
            return tz_name, factory_schedules

    region_schedules = list(
        db.scalars(
            select(ShiftSchedule)
            .where(
                ShiftSchedule.region_id == region_id,
                ShiftSchedule.factory_id.is_(None),
                ShiftSchedule.is_active.is_(True),
            )
        )
    )
    region_schedules.sort(key=lambda s: _parse_hhmm(s.start_time))
    return tz_name, region_schedules


def resolve_shift_context(
    db: Session,
    region_id: str,
    factory_id: str | None = None,
    at_utc: datetime | None = None,
    handover_pending_count: int = 0,
) -> ShiftContextDTO:
    """Compute current, previous, and upcoming shift in the region/factory timezone."""
    tz_name, schedules = get_effective_schedules(db, region_id, factory_id)
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc
        tz_name = "UTC"

    ref_utc = at_utc or datetime.now(timezone.utc)
    if ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=timezone.utc)
    local_dt = ref_utc.astimezone(tz)
    minute_of_day = local_dt.hour * 60 + local_dt.minute

    windows = [_to_window_dto(s) for s in schedules]
    current_idx: int | None = None
    for idx, s in enumerate(schedules):
        start_m = _parse_hhmm(s.start_time)
        end_m = _parse_hhmm(s.end_time)
        if _matches_minute(minute_of_day, start_m, end_m):
            current_idx = idx
            break

    current_shift = windows[current_idx] if current_idx is not None else None
    previous_shift = windows[(current_idx - 1) % len(windows)] if current_idx is not None and windows else None
    upcoming_shift = windows[(current_idx + 1) % len(windows)] if current_idx is not None and windows else None

    minutes_to_transition: int | None = None
    if current_idx is not None:
        end_m = _parse_hhmm(schedules[current_idx].end_time)
        minutes_to_transition = _minutes_until(minute_of_day, end_m)

    return ShiftContextDTO(
        timezone=tz_name,
        local_time_iso=local_dt.isoformat(),
        current_shift=current_shift,
        previous_shift=previous_shift,
        upcoming_shift=upcoming_shift,
        minutes_to_transition=minutes_to_transition,
        handover_pending_count=handover_pending_count,
        schedules=windows,
    )


def simulate_shift_transition(
    db: Session,
    region_id: str,
    factory_id: str | None = None,
) -> dict:
    """Advance shift logically for simulation/testing without discarding pending handovers."""
    ctx = resolve_shift_context(db, region_id, factory_id)
    prev_name = ctx.current_shift.shift_name if ctx.current_shift else "Previous Shift"
    next_name = ctx.upcoming_shift.shift_name if ctx.upcoming_shift else "Next Shift"

    factory_query = select(Factory).where(Factory.region_id == region_id)
    if factory_id:
        factory_query = factory_query.where(Factory.id == factory_id)
    factories = list(db.scalars(factory_query))

    flagged_count = 0
    for fac in factories:
        fac.active_shift_name = next_name
        lines = list(db.scalars(select(ProductionLine).where(ProductionLine.factory_id == fac.id)))
        for line in lines:
            machines = list(db.scalars(select(Machine).where(Machine.line_id == line.id)))
            for m in machines:
                state = db.scalar(select(MachineState).where(MachineState.machine_id == m.id))
                if state:
                    state.handover_status = "pending"
                    flagged_count += 1
                    db.add(
                        MachineEvent(
                            machine_id=m.id,
                            factory_id=fac.id,
                            region_id=region_id,
                            line_id=line.id,
                            shift_name=next_name,
                            event_type="shift_transition",
                            severity="warning",
                            previous_status=state.status,
                            new_status=state.status,
                            message=f"Shift transitioned {prev_name} -> {next_name}; handover pending review.",
                            data_source="simulation",
                        )
                    )

    log = ShiftTransitionLog(
        region_id=region_id,
        factory_id=factory_id,
        previous_shift_name=prev_name,
        new_shift_name=next_name,
        timezone=ctx.timezone,
        machines_flagged_pending=flagged_count,
        notes=f"Simulated transition from {prev_name} to {next_name} ({ctx.timezone})",
    )
    db.add(log)
    db.commit()

    return {
        "region_id": region_id,
        "factory_id": factory_id,
        "previous_shift": prev_name,
        "new_shift": next_name,
        "timezone": ctx.timezone,
        "machines_flagged_pending": flagged_count,
    }

