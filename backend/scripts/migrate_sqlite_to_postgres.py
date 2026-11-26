"""Safely migrate existing SQLite records (digital_twin.db) into a PostgreSQL database.

Usage (from project root / backend directory):
    export TARGET_DATABASE_URL="postgresql://user:pass@host:5432/ps032_digital_twin"
    python backend/scripts/migrate_sqlite_to_postgres.py

Behavior:
- Never deletes or modifies the local SQLite database.
- Initializes missing tables/columns via ensure_schema_upgrades().
- Preserves primary keys and relationships cleanly in foreign-key dependency order.
- Skips rows whose primary keys already exist in the target PostgreSQL database (safe on re-runs).
- Resets PostgreSQL SERIAL sequences after copying integer-ID rows.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import os
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import inspect, select, text
from app.database import Base, create_db_engine, ensure_schema_upgrades
import app.models  # noqa: F401
import app.models_ps032  # noqa: F401


TABLE_COPY_ORDER = [
    # Phase 1 Digital Twin Hierarchy & Telemetry
    "dt_companies",
    "dt_regions",
    "dt_factories",
    "dt_production_lines",
    "dt_machines",
    "dt_machine_specifications",
    "dt_machine_states",
    "dt_sensor_readings",
    "dt_machine_events",
    "dt_shift_schedules",
    # Phase 2+ Industrial Operations, RBAC & Reports
    "ps032_users",
    "ps032_tasks",
    "ps032_submissions",
    "ps032_production_entries",
    "ps032_abnormalities",
    "ps032_maintenance_records",
    "ps032_cleaning_logs",
    "ps032_handover_records",
    "ps032_audit_events",
    "ps032_operator_assignments",
    "ps032_downtime_events",
    "ps032_safety_checklists",
    "ps032_maintenance_schedules",
    "ps032_quality_inspections",
]


def migrate_sqlite_to_postgres(sqlite_url: str, target_url: str) -> dict[str, int]:
    src_engine = create_db_engine(sqlite_url)
    dst_engine = create_db_engine(target_url)

    ensure_schema_upgrades(dst_engine)

    src_insp = inspect(src_engine)
    metadata_tables = Base.metadata.tables
    summary: dict[str, int] = {}

    with src_engine.connect() as src_conn, dst_engine.begin() as dst_conn:
        for table_name in TABLE_COPY_ORDER:
            if not src_insp.has_table(table_name) or table_name not in metadata_tables:
                summary[table_name] = 0
                continue

            table = metadata_tables[table_name]
            pk_cols = list(table.primary_key.columns)
            src_rows = src_conn.execute(select(table)).mappings().all()
            if not src_rows:
                summary[table_name] = 0
                continue

            existing_pks: set[tuple] = set()
            if pk_cols:
                existing_pks = {
                    tuple(row[c.name] for c in pk_cols)
                    for row in dst_conn.execute(select(*pk_cols)).mappings()
                }

            to_insert = []
            for row in src_rows:
                pk_tuple = tuple(row[c.name] for c in pk_cols) if pk_cols else None
                if pk_tuple is not None and pk_tuple in existing_pks:
                    continue
                to_insert.append(dict(row))

            if to_insert:
                dst_conn.execute(table.insert(), to_insert)

            summary[table_name] = len(to_insert)

            # Reset PostgreSQL sequence for single integer primary keys
            if (
                dst_engine.dialect.name == "postgresql"
                and len(pk_cols) == 1
                and pk_cols[0].autoincrement is not False
                and "int" in str(pk_cols[0].type).lower()
            ):
                pk_col = pk_cols[0].name
                seq_sql = text(
                    "SELECT setval(pg_get_serial_sequence(:tbl, :col), "
                    "COALESCE((SELECT MAX(" + pk_col + ") FROM " + table_name + "), 1), true)"
                )
                dst_conn.execute(seq_sql, {"tbl": table_name, "col": pk_col})

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate SQLite digital_twin.db data into PostgreSQL.")
    parser.add_argument(
        "--source",
        default=f"sqlite:///{BACKEND_DIR / 'digital_twin.db'}",
        help="Source SQLite database URL",
    )
    parser.add_argument(
        "--target",
        default=os.environ.get("TARGET_DATABASE_URL") or os.environ.get("DATABASE_URL") or "",
        help="Target PostgreSQL database URL",
    )
    args = parser.parse_args()
    if not args.target:
        raise SystemExit("Error: pass --target or set TARGET_DATABASE_URL / DATABASE_URL.")

    counts = migrate_sqlite_to_postgres(args.source, args.target)
    total = sum(counts.values())
    print(f"Migration complete ({total} new rows inserted):")
    for tbl, cnt in counts.items():
        if cnt > 0:
            print(f"  {tbl}: +{cnt}")


if __name__ == "__main__":
    main()
