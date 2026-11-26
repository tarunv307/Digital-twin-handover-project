"""Simulation controller service shared by REST API and lifespan task."""

import asyncio
from datetime import datetime, timezone
import logging
import random
from typing import Literal
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import SessionLocal
from app.models import Machine, MachineEvent, MachineState
from app.schemas import SimulationStatusDTO, TelemetryIngestItem
from app.services.telemetry_service import ingest_telemetry_items
from app.services.ws_manager import ws_manager

logger = logging.getLogger("simulation_runner")


class SimulationController:
    """Drives realistic simulated machine telemetry through the standard ingest pipeline."""

    def __init__(self) -> None:
        self.state: Literal["running", "paused", "stopped"] = "stopped"
        self.interval_sec: float = get_settings().simulation_interval_sec
        self.ticks_emitted: int = 0
        self.last_tick_at: datetime | None = None
        self.simulated_machines_count: int = 0
        self.session_factory = SessionLocal
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    @property
    def running(self) -> bool:
        return self.state == "running"

    @property
    def paused(self) -> bool:
        return self.state == "paused"

    def _count_machines(self) -> int:
        if self.simulated_machines_count > 0:
            return self.simulated_machines_count
        try:
            db = self.session_factory()
            try:
                cnt = db.scalar(select(func.count(Machine.id))) or 0
                self.simulated_machines_count = int(cnt)
            finally:
                db.close()
        except Exception:
            pass
        return self.simulated_machines_count

    def status_dto(self) -> SimulationStatusDTO:
        return SimulationStatusDTO(
            state=self.state,
            running=self.running,
            paused=self.paused,
            interval_sec=self.interval_sec,
            mode="simulation",
            simulated_machines_count=self._count_machines(),
            ticks_emitted=self.ticks_emitted,
            last_tick_at=self.last_tick_at,
        )

    def _ensure_loop_running(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop())

    async def start(self, db: Session | None = None) -> SimulationStatusDTO:
        async with self._lock:
            self.state = "running"
            self._ensure_loop_running()
            await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
        # Emit an immediate tick on start so UI reflects fresh telemetry right away
        await self.run_single_tick(db)
        return self.status_dto()

    async def pause(self) -> SimulationStatusDTO:
        async with self._lock:
            if self.state == "running":
                self.state = "paused"
                if self._task and not self._task.done():
                    self._task.cancel()
                    try:
                        await self._task
                    except asyncio.CancelledError:
                        pass
                self._task = None
                await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
        return self.status_dto()

    async def resume(self, db: Session | None = None) -> SimulationStatusDTO:
        async with self._lock:
            self.state = "running"
            self._ensure_loop_running()
            await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
        await self.run_single_tick(db)
        return self.status_dto()

    async def stop(self) -> SimulationStatusDTO:
        async with self._lock:
            self.state = "stopped"
            if self._task and not self._task.done():
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            self._task = None
            await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
        return self.status_dto()

    async def set_interval(self, interval_sec: float) -> SimulationStatusDTO:
        async with self._lock:
            self.interval_sec = max(0.5, min(30.0, float(interval_sec)))
            await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
        return self.status_dto()

    async def reset(self, db: Session | None = None) -> SimulationStatusDTO:
        """Reset faulted/simulated counters cleanly to nominal operating parameters."""
        close_after = False
        if db is None:
            db = self.session_factory()
            close_after = True
        try:
            machines = list(db.scalars(select(Machine).options(selectinload(Machine.state))))
            items: list[TelemetryIngestItem] = []
            for m in machines:
                st = m.state
                if not st:
                    continue
                nominal_status = "Idle" if m.id in ("mch-chn-104", "mch-hsr-304") else "Running"
                items.append(
                    TelemetryIngestItem(
                        machine_id=m.id,
                        status=nominal_status,
                        temperature_c=52.0 if nominal_status == "Running" else 31.0,
                        vibration_mm_s=1.5 if nominal_status == "Running" else 0.3,
                        energy_kw=24.0 if nominal_status == "Running" else 5.2,
                        cycle_time_sec=st.cycle_time_sec or 22.0,
                        data_source="simulation",
                        event_type="simulation_reset" if st.status != nominal_status else None,
                        event_message=f"{m.code} reset to {nominal_status} by Simulation Reset." if st.status != nominal_status else None,
                    )
                )
            updates = ingest_telemetry_items(db, items)
            self.ticks_emitted = 0
            self.last_tick_at = datetime.now(timezone.utc)
            self.simulated_machines_count = len(machines)
            if updates:
                await ws_manager.broadcast(
                    "telemetry_batch",
                    {
                        "updates": updates,
                        "simulation": self.status_dto().model_dump(mode="json"),
                        "timestamp": self.last_tick_at.isoformat(),
                    },
                )
            await ws_manager.broadcast("simulation_status", self.status_dto().model_dump(mode="json"))
            return self.status_dto()
        finally:
            if close_after:
                db.close()

    async def run_single_tick(self, db: Session | None = None) -> list[dict]:
        close_after = False
        if db is None:
            db = self.session_factory()
            close_after = True
        try:
            machines = list(db.scalars(select(Machine).options(selectinload(Machine.state))))
            self.simulated_machines_count = len(machines)
            items: list[TelemetryIngestItem] = []
            for m in machines:
                st = m.state
                if not st:
                    continue
                if st.status == "Running":
                    temp = max(28.0, min(74.0, (st.temperature_c or 46.0) + random.uniform(-0.9, 1.1)))
                    vib = max(0.3, min(3.4, (st.vibration_mm_s or 1.4) + random.uniform(-0.18, 0.2)))
                    kw = max(4.5, min(52.0, (st.energy_kw or 20.0) + random.uniform(-0.9, 0.9)))
                    cycle = max(8.0, min(45.0, (st.cycle_time_sec or 22.0) + random.uniform(-0.4, 0.4)))
                    prod_delta = 1 if random.random() < 0.78 else 0
                    items.append(
                        TelemetryIngestItem(
                            machine_id=m.id,
                            status="Running",
                            temperature_c=temp,
                            vibration_mm_s=vib,
                            cycle_time_sec=cycle,
                            energy_kw=kw,
                            production_delta=prod_delta,
                            data_source="simulation",
                        )
                    )
                elif st.status == "Idle":
                    temp = max(24.0, min(38.0, (st.temperature_c or 30.0) + random.uniform(-0.35, 0.35)))
                    items.append(
                        TelemetryIngestItem(
                            machine_id=m.id,
                            status="Idle",
                            temperature_c=temp,
                            vibration_mm_s=round(random.uniform(0.2, 0.4), 2),
                            energy_kw=max(2.0, min(8.0, (st.energy_kw or 5.0) + random.uniform(-0.25, 0.25))),
                            data_source="simulation",
                        )
                    )
                elif st.status in ("Fault", "Maintenance", "Stopped"):
                    # Keep Fault/Maintenance/Stopped state authoritative; simulate realistic cool-down & downtime accrual
                    temp = max(24.0, (st.temperature_c or 40.0) - (0.15 if st.status == "Fault" else 0.3))
                    vib = st.vibration_mm_s if st.status == "Fault" else 0.2
                    items.append(
                        TelemetryIngestItem(
                            machine_id=m.id,
                            status=st.status,  # type: ignore[arg-type]
                            temperature_c=temp,
                            vibration_mm_s=vib,
                            downtime_delta_min=round(self.interval_sec / 60.0, 3),
                            data_source="simulation",
                        )
                    )
                else:
                    items.append(
                        TelemetryIngestItem(
                            machine_id=m.id,
                            status=st.status,  # type: ignore[arg-type]
                            data_source="simulation",
                        )
                    )

            updates = ingest_telemetry_items(db, items)
            self.ticks_emitted += 1
            self.last_tick_at = datetime.now(timezone.utc)
            status_payload = self.status_dto().model_dump(mode="json")
            if updates:
                await ws_manager.broadcast(
                    "telemetry_batch",
                    {
                        "updates": updates,
                        "tick": self.ticks_emitted,
                        "simulation": status_payload,
                        "timestamp": self.last_tick_at.isoformat(),
                    },
                )
            return updates
        finally:
            if close_after:
                db.close()

    async def _loop(self) -> None:
        while self.state == "running":
            try:
                await self.run_single_tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Simulation tick error: %s", exc)
            await asyncio.sleep(self.interval_sec)


simulation_controller = SimulationController()
