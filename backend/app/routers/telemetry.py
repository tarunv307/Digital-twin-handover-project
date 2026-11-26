"""Telemetry ingestion and Simulation Mode control endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Machine, Region
from app.schemas import (
    SimulationCommandRequest,
    SimulationIntervalRequest,
    SimulationStatusDTO,
    TelemetryBatchRequest,
    TelemetryIngestItem,
)
from app.services.shift_engine import simulate_shift_transition
from app.services.simulation_runner import simulation_controller
from app.services.telemetry_service import ingest_telemetry_items
from app.services.ws_manager import ws_manager

router = APIRouter(prefix="/api/dt", tags=["telemetry-simulation"])


@router.post("/telemetry/batch")
async def ingest_telemetry_batch(payload: TelemetryBatchRequest, db: Session = Depends(get_db)):
    updates = ingest_telemetry_items(db, payload.items)
    if updates:
        await ws_manager.broadcast(
            "telemetry_batch",
            {"updates": updates, "simulation": simulation_controller.status_dto().model_dump(mode="json")},
        )
    return {"accepted": len(updates), "updates": updates}


@router.get("/simulation/status", response_model=SimulationStatusDTO)
def get_simulation_status():
    return simulation_controller.status_dto()


@router.post("/simulation/start", response_model=SimulationStatusDTO)
async def start_simulation(db: Session = Depends(get_db)):
    return await simulation_controller.start(db)


@router.post("/simulation/pause", response_model=SimulationStatusDTO)
async def pause_simulation():
    return await simulation_controller.pause()


@router.post("/simulation/resume", response_model=SimulationStatusDTO)
async def resume_simulation(db: Session = Depends(get_db)):
    return await simulation_controller.resume(db)


@router.post("/simulation/stop", response_model=SimulationStatusDTO)
async def stop_simulation():
    return await simulation_controller.stop()


@router.post("/simulation/reset", response_model=SimulationStatusDTO)
async def reset_simulation(db: Session = Depends(get_db)):
    return await simulation_controller.reset(db)


@router.post("/simulation/interval", response_model=SimulationStatusDTO)
async def set_simulation_interval(payload: SimulationIntervalRequest):
    return await simulation_controller.set_interval(payload.interval_sec)


@router.post("/simulation/tick")
async def trigger_simulation_tick(db: Session = Depends(get_db)):
    updates = await simulation_controller.run_single_tick(db)
    return {
        "ticks_emitted": simulation_controller.ticks_emitted,
        "updated_machines": len(updates),
        "simulation": simulation_controller.status_dto().model_dump(mode="json"),
    }


@router.post("/simulation/fault")
async def trigger_simulated_fault(payload: SimulationCommandRequest, db: Session = Depends(get_db)):
    machine_id = payload.machine_id or "mch-chn-103"
    if db.get(Machine, machine_id) is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=machine_id,
                status="Fault",
                temperature_c=78.6,
                vibration_mm_s=6.4,
                energy_kw=9.2,
                fault_code=payload.fault_code or "E-402",
                fault_message=payload.fault_message or "Simulated spindle thermal overload",
                data_source="simulation",
                event_type="fault_detected",
            )
        ],
    )
    await ws_manager.broadcast(
        "telemetry_batch",
        {"updates": updates, "simulation": simulation_controller.status_dto().model_dump(mode="json")},
    )
    return {"status": "fault_triggered", "machine_id": machine_id, "updates": updates}


@router.post("/simulation/recover")
async def recover_simulated_machine(payload: SimulationCommandRequest, db: Session = Depends(get_db)):
    machine_id = payload.machine_id or "mch-chn-103"
    if db.get(Machine, machine_id) is None:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=machine_id,
                status="Running",
                temperature_c=52.4,
                vibration_mm_s=1.6,
                cycle_time_sec=26.5,
                energy_kw=28.0,
                data_source="simulation",
                event_type="fault_cleared",
                event_message=f"Simulated recovery completed on {machine_id}; machine resumed Running.",
            )
        ],
    )
    await ws_manager.broadcast(
        "telemetry_batch",
        {"updates": updates, "simulation": simulation_controller.status_dto().model_dump(mode="json")},
    )
    return {"status": "recovered", "machine_id": machine_id, "updates": updates}


@router.post("/simulation/set-status")
async def set_simulated_machine_status(payload: SimulationCommandRequest, db: Session = Depends(get_db)):
    if not payload.machine_id or not payload.target_status:
        raise HTTPException(status_code=400, detail="machine_id and target_status are required")
    if db.get(Machine, payload.machine_id) is None:
        raise HTTPException(status_code=404, detail=f"Machine {payload.machine_id} not found")

    updates = ingest_telemetry_items(
        db,
        [
            TelemetryIngestItem(
                machine_id=payload.machine_id,
                status=payload.target_status,
                data_source="simulation",
                sensor_connectivity="offline" if payload.target_status == "Offline" else "connected",
            )
        ],
    )
    await ws_manager.broadcast(
        "telemetry_batch",
        {"updates": updates, "simulation": simulation_controller.status_dto().model_dump(mode="json")},
    )
    return {"status": "updated", "machine_id": payload.machine_id, "updates": updates}


@router.post("/simulation/shift-transition")
async def trigger_shift_transition(payload: SimulationCommandRequest, db: Session = Depends(get_db)):
    region_id = payload.region_id
    if not region_id:
        first_region = db.scalar(select(Region.id).limit(1))
        if not first_region:
            raise HTTPException(status_code=404, detail="No regions configured")
        region_id = first_region
    result = simulate_shift_transition(db, region_id=region_id, factory_id=payload.factory_id)
    await ws_manager.broadcast("shift_transition", result)
    return result
