"""FastAPI entry point for the PS-032 Industrial Digital Twin & Smart Shift Handover backend."""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text

from app.config import get_settings
from app.database import SessionLocal, engine, ensure_schema_upgrades
import app.models_ps032  # noqa: F401  Ensure PS-032 tables register with SQLAlchemy Base
from app.routers import assignments, auth_users, digital_twin, operations, reports, telemetry, ws
from app.seed import ensure_hierarchy_display_names, seed_database_if_empty
from app.seed_ps032 import seed_ps032_if_empty
from app.services.simulation_runner import simulation_controller
from app.services.ws_manager import ws_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_schema_upgrades(engine)
    db = SessionLocal()
    try:
        seed_database_if_empty(db)
        ensure_hierarchy_display_names(db)
        seed_ps032_if_empty(db)
    finally:
        db.close()

    if get_settings().simulation_autostart:
        await simulation_controller.start()
    yield
    await simulation_controller.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.2.0",
        description="PS-032 Industrial Digital Twin & Smart Shift Handover Platform.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(digital_twin.router)
    app.include_router(telemetry.router)
    app.include_router(auth_users.router)
    app.include_router(operations.router)
    app.include_router(assignments.router)
    app.include_router(reports.router)
    app.include_router(ws.router)

    @app.get("/api/health")
    def health():
        db_ok = False
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False
        finally:
            db.close()
        return {
            "status": "ok" if db_ok else "degraded",
            "database": "ok" if db_ok else "error",
            "service": "ps032-digital-twin-and-handover",
            "ws_clients": ws_manager.client_count,
            "simulation": simulation_controller.status_dto().model_dump(mode="json"),
        }

    # Unified production mode: serve built Vite SPA if frontend/dist is present and enabled
    dist_dir = Path(settings.frontend_dist_dir).resolve()
    index_html = dist_dir / "index.html"
    if settings.serve_frontend and index_html.is_file():

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str):
            normalized = full_path.lstrip("/")
            if (
                normalized == "api"
                or normalized.startswith("api/")
                or normalized == "ws"
                or normalized.startswith("ws/")
            ):
                raise HTTPException(status_code=404, detail="Endpoint not found")
            if normalized:
                candidate = (dist_dir / normalized).resolve()
                if candidate.is_relative_to(dist_dir) and candidate.is_file():
                    return FileResponse(str(candidate))
            return FileResponse(str(index_html))

    return app


app = create_app()
