"""Tests verifying Render production readiness: Postgres URL handling, SPA serving, health, and migration."""

from pathlib import Path
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.database import Base, create_db_engine, get_db, normalize_database_url
from app.main import create_app
from app.models import Company, Factory
import app.models_ps032  # noqa: F401
from app.models_ps032 import UserAccount
from app.seed import seed_database_if_empty
from app.seed_ps032 import seed_ps032_if_empty
from scripts.migrate_sqlite_to_postgres import migrate_sqlite_to_postgres


def test_postgres_url_normalization_and_render_env_aliases(monkeypatch):
    assert (
        normalize_database_url("postgres://u:p@dpg-host:5432/ps032_db")
        == "postgresql+psycopg://u:p@dpg-host:5432/ps032_db"
    )
    assert (
        normalize_database_url("postgresql://u:p@dpg-host:5432/ps032_db")
        == "postgresql+psycopg://u:p@dpg-host:5432/ps032_db"
    )
    assert normalize_database_url("sqlite:///./digital_twin.db") == "sqlite:///./digital_twin.db"

    # Verify psycopg v3 driver builds a valid PostgreSQL Engine object
    pg_eng = create_db_engine("postgres://u:p@localhost:5432/ps032_db")
    assert pg_eng.dialect.name == "postgresql"
    assert pg_eng.dialect.driver == "psycopg"

    # Render injects DATABASE_URL & RENDER_EXTERNAL_URL cleanly
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@host:5432/db")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://ps032-digital-twin.onrender.com/")
    monkeypatch.setenv("DT_CORS_ORIGINS", "http://localhost:5173")
    s = Settings(_env_file=None)
    assert s.database_url == "postgres://user:pw@host:5432/db"
    assert "https://ps032-digital-twin.onrender.com" in s.cors_origin_list
    assert "http://localhost:5173" in s.cors_origin_list


def test_health_and_unified_spa_serving():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_database_if_empty(db)
    seed_ps032_if_empty(db)
    db.close()

    app = create_app()

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.json()["database"] == "ok"

    # API 404 must remain JSON 404 rather than returning SPA index.html
    missing_api = client.get("/api/does-not-exist")
    assert missing_api.status_code == 404

    dist_index = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "index.html"
    if dist_index.is_file():
        root_res = client.get("/")
        assert root_res.status_code == 200
        assert "text/html" in root_res.headers["content-type"]
        spa_deep = client.get("/digital-twin/reports")
        assert spa_deep.status_code == 200
        assert "text/html" in spa_deep.headers["content-type"]


def test_sqlite_migration_script_is_idempotent(tmp_path: Path):
    src_db = tmp_path / "src.db"
    dst_db = tmp_path / "dst.db"
    src_url = f"sqlite:///{src_db}"
    dst_url = f"sqlite:///{dst_db}"

    src_eng = create_db_engine(src_url)
    Base.metadata.create_all(bind=src_eng)
    SrcSession = sessionmaker(bind=src_eng)
    with SrcSession() as db:
        seed_database_if_empty(db)
        seed_ps032_if_empty(db)

    first = migrate_sqlite_to_postgres(src_url, dst_url)
    assert first["dt_companies"] == 1
    assert first["dt_factories"] == 4
    assert first["ps032_users"] >= 5

    # Repeat migration skips existing PKs cleanly without duplicating records
    second = migrate_sqlite_to_postgres(src_url, dst_url)
    assert all(cnt == 0 for cnt in second.values())

    dst_eng = create_db_engine(dst_url)
    DstSession = sessionmaker(bind=dst_eng)
    with DstSession() as db:
        assert db.scalar(select(Company.name)) == "Apex Precision Manufacturing"
        assert len(list(db.scalars(select(Factory)))) == 4
        assert len(list(db.scalars(select(UserAccount)))) >= 5
