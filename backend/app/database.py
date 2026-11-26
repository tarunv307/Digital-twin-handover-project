"""SQLAlchemy engine and session management with SQLite WAL and Render PostgreSQL support."""

from collections.abc import Generator
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """Base declarative class for all Digital Twin SQLAlchemy models."""


def normalize_database_url(raw_url: str) -> str:
    """Normalize Render postgres:// / postgresql:// URLs to SQLAlchemy psycopg v3 dialect."""
    url = raw_url.strip()
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def create_db_engine(database_url: str | None = None):
    url = normalize_database_url(database_url or get_settings().database_url)
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False, "timeout": 15}
        eng = create_engine(url, connect_args=connect_args, future=True)
        if ":memory:" not in url:
            @event.listens_for(eng, "connect")
            def _set_sqlite_pragmas(dbapi_connection, _connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL;")
                cursor.execute("PRAGMA synchronous=NORMAL;")
                cursor.execute("PRAGMA busy_timeout=5000;")
                cursor.close()
        return eng

    # Managed PostgreSQL production configuration (Render Postgres)
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        future=True,
    )


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def ensure_schema_upgrades(target_engine=None) -> None:
    """Safely create any missing tables and apply additive column migrations if needed."""
    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)
    insp = inspect(eng)
    additive_columns = {
        "dt_companies": [
            ("latitude", "FLOAT DEFAULT 21.1458"),
            ("longitude", "FLOAT DEFAULT 79.0882"),
        ],
        "dt_regions": [
            ("latitude", "FLOAT DEFAULT 20.5937"),
            ("longitude", "FLOAT DEFAULT 78.9629"),
        ],
        "dt_factories": [
            ("latitude", "FLOAT DEFAULT 11.0168"),
            ("longitude", "FLOAT DEFAULT 76.9558"),
            ("location_label", "VARCHAR(140) DEFAULT 'India'"),
        ],
    }
    with eng.begin() as conn:
        for tbl, cols in additive_columns.items():
            if not insp.has_table(tbl):
                continue
            existing = {c["name"] for c in insp.get_columns(tbl)}
            for col_name, col_def in cols:
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col_name} {col_def}"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
