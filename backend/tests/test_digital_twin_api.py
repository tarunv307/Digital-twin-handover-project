"""Integration tests for hierarchical Digital Twin REST API and fault simulation."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.seed import seed_database_if_empty


def _create_test_client() -> TestClient:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)
    db = TestingSession()
    seed_database_if_empty(db)
    db.close()

    app = create_app()

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_company_to_machine_hierarchy_and_ordering():
    client = _create_test_client()

    comp = client.get("/api/dt/company")
    assert comp.status_code == 200
    comp_data = comp.json()
    assert comp_data["summary"]["total_factories"] == 4
    assert comp_data["summary"]["total_machines"] == 23
    assert len(comp_data["regions"]) == 3

    reg = client.get("/api/dt/regions/reg-south-india")
    assert reg.status_code == 200
    assert len(reg.json()["factories"]) == 2

    fac = client.get("/api/dt/factories/fac-chn-a")
    assert fac.status_code == 200
    assert len(fac.json()["production_lines"]) == 2

    line = client.get("/api/dt/lines/line-chn-01")
    assert line.status_code == 200
    machines = line.json()["machines"]
    assert [m["sequence_order"] for m in machines] == [1, 2, 3, 4, 5, 6]

    # Verify partial specs remain null rather than invented
    m5 = client.get("/api/dt/machines/mch-chn-105")
    assert m5.status_code == 200
    assert m5.json()["specification"]["serial_number"] is None
    assert m5.json()["specification"]["installation_date"] is None

    # Verify QR lookup works
    qr = client.get("/api/dt/machines/by-qr/QR-MCH-103")
    assert qr.status_code == 200
    assert qr.json()["id"] == "mch-chn-103"


def test_fault_simulation_recovery_and_events():
    client = _create_test_client()

    fault_resp = client.post(
        "/api/dt/simulation/fault",
        json={"machine_id": "mch-chn-103", "fault_code": "E-402", "fault_message": "Thermal spike"},
    )
    assert fault_resp.status_code == 200

    m3 = client.get("/api/dt/machines/mch-chn-103").json()
    assert m3["state"]["status"] == "Fault"
    assert m3["state"]["active_fault_code"] == "E-402"

    rec_resp = client.post("/api/dt/simulation/recover", json={"machine_id": "mch-chn-103"})
    assert rec_resp.status_code == 200

    m3_after = client.get("/api/dt/machines/mch-chn-103").json()
    assert m3_after["state"]["status"] == "Running"
    assert m3_after["state"]["active_fault_code"] is None

    events = client.get("/api/dt/events?machine_id=mch-chn-103").json()
    assert len(events) >= 2


def test_shift_schedule_update():
    client = _create_test_client()
    patch_resp = client.patch(
        "/api/dt/shifts/sh-ind-morning",
        json={"supervisor": "K. Subramanian", "handover_deadline_minutes": 15},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["supervisor"] == "K. Subramanian"
    assert patch_resp.json()["handover_deadline_minutes"] == 15

