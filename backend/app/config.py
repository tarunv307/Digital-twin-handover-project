"""Application configuration for the PS-032 Digital Twin & Shift Handover backend."""

from functools import lru_cache
import os
from pathlib import Path
from typing import Literal, Optional
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent


class Settings(BaseSettings):
    app_name: str = "PS-032 Industrial Digital Twin & Smart Shift Handover"
    database_url: str = Field(
        default="sqlite:///./digital_twin.db",
        validation_alias=AliasChoices("DT_DATABASE_URL", "DATABASE_URL"),
    )
    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173,http://localhost:5050",
        validation_alias=AliasChoices("DT_CORS_ORIGINS", "CORS_ORIGINS"),
    )
    simulation_autostart: bool = False
    simulation_interval_sec: float = 2.0
    stale_threshold_sec: int = 15
    secret_key: str = Field(
        default="ps032-industrial-shift-handover-secret-2026",
        validation_alias=AliasChoices("DT_SECRET_KEY", "SECRET_KEY"),
    )
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    output_dir: str = str(BASE_DIR / "output")
    upload_dir: str = str(BASE_DIR / "uploads")
    serve_frontend: bool = True
    frontend_dist_dir: str = str(PROJECT_ROOT / "frontend" / "dist")
    cookie_secure: Optional[bool] = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    model_config = SettingsConfigDict(
        env_prefix="DT_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]
        render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
        if render_url and render_url not in origins:
            origins.append(render_url)
        return origins


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    Path(settings.output_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    return settings
