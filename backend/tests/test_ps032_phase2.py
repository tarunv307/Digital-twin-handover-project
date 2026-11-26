"""End-to-end Phase 2 integration tests: auth, RBAC, abnormalities, handover PDF, ack, and audit trail."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
import app.models_ps032  # noqa: F401
from app.seed import seed_database_if_empty
from app.seed_ps032 import seed_ps032_if_empty


def _create_client() -> TestClient:
    from app.services.simulation_runner import simulation_controller

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

    simulation_controller.session_factory = TestingSession
    simulation_controller.state = "stopped"
    simulation_controller.ticks_emitted = 0
    simulation_controller.simulated_machines_count = 0

    app = create_app()

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_required_end_to_end_ps032_workflow():
    client = _create_client()

    # 1-4. Company -> Region -> Factory -> Line -> Machine MCH-103
    comp_before = client.get("/api/dt/company").json()
    pending_before = comp_before["summary"]["pending_handovers"]
    assert pending_before >= 1

    # Unauthorized user cannot acknowledge handover
    unauth_ack = client.post(
        "/api/ps032/handovers/HO-CHN-103-INITIAL/acknowledge",
        json={"remarks": "Unauthorized attempt", "condition_confirmed": True},
    )
    assert unauth_ack.status_code == 401

    # 5. Log in as outgoing operator and trigger simulated fault
    login_out = client.post("/api/login", json={"email": "john@example.com", "password": "employee123"})
    assert login_out.status_code == 200
    token_out = login_out.json()["access_token"]
    headers_out = {"Authorization": f"Bearer {token_out}"}

    fault_res = client.post("/api/dt/simulation/fault", json={"machine_id": "mch-chn-103"})
    assert fault_res.status_code == 200

    # 6. Create abnormality record
    abn_res = client.post(
        "/api/ps032/abnormalities",
        headers=headers_out,
        json={
            "machine_id": "mch-chn-103",
            "title": "Spindle thermal limit breach during finish bore",
            "description": "Temperature spiked to 78.6C; operator paused cycle for thermal check.",
            "severity": "critical",
            "fault_code": "E-402",
        },
    )
    assert abn_res.status_code == 201
    abn_code = abn_res.json()["code"]

    # Record production entry & 5S cleaning log
    prod_res = client.post(
        "/api/ps032/production",
        headers=headers_out,
        json={"machine_id": "mch-chn-103", "units_produced": 144, "reject_units": 2, "downtime_minutes": 6.0},
    )
    assert prod_res.status_code == 201

    clean_res = client.post(
        "/api/ps032/cleaning",
        headers=headers_out,
        json={"machine_id": "mch-chn-103", "area_cleaned": True, "lubrication_checked": True, "guards_verified": True},
    )
    assert clean_res.status_code == 201

    # 7. Generate machine-wise shift handover (3-stage pipeline + PDF)
    ho_res = client.post(
        "/api/ps032/handovers/generate",
        headers=headers_out,
        json={
            "machine_id": "mch-chn-103",
            "operator_remarks": "Handover includes thermal spike abnormality for incoming check.",
            "incoming_operator": "M. Priya (Incoming Shift Operator)",
        },
    )
    assert ho_res.status_code == 201
    ho_data = ho_res.json()
    assert ho_data["status"] == "pending"
    assert ho_data["pending_abnormalities_count"] >= 1
    assert ho_data["pdf_filename"].endswith(".pdf")

    pdf_res = client.get(f"/api/download/{ho_data['pdf_filename']}")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"

    # 8. Log in as incoming operator
    login_in = client.post("/api/login", json={"email": "operator@example.com", "password": "operator123"})
    assert login_in.status_code == 200
    headers_in = {"Authorization": f"Bearer {login_in.json()['access_token']}"}

    # 9. Review & acknowledge both initial and newly generated pending handovers for MCH-103
    for ho_id in ("HO-CHN-103-INITIAL", ho_data["id"]):
        ack_res = client.post(
            f"/api/ps032/handovers/{ho_id}/acknowledge",
            headers=headers_in,
            json={"remarks": "Reviewed abnormality and coolant check instructions; taking over shift.", "condition_confirmed": True},
        )
        assert ack_res.status_code == 200
        assert ack_res.json()["status"] == "acknowledged"
        assert ack_res.json()["acknowledged_by_name"] == "M. Priya (Incoming Shift Operator)"

    # 10. Verify machine, factory, region, and company summaries updated
    m103 = client.get("/api/dt/machines/mch-chn-103").json()
    assert m103["state"]["handover_status"] == "complete"
    comp_after = client.get("/api/dt/company").json()
    assert comp_after["summary"]["pending_handovers"] == pending_before - 1

    # 11. Verify audit trail recorded abnormality, handover generation, and acknowledgement
    audit = client.get("/api/ps032/audit?machine_id=mch-chn-103").json()
    actions = {a["action"] for a in audit}
    assert "abnormality_created" in actions
    assert "handover_generated" in actions
    assert "handover_acknowledged" in actions
    assert any(abn_code in a["details"] for a in audit)


def test_rbac_matrix_all_five_roles_and_global_search():
    client = _create_client()

    def login_headers(email: str, password: str) -> dict[str, str]:
        r = client.post("/api/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    h_admin = login_headers("admin@example.com", "admin123")
    h_reg = login_headers("regional@example.com", "regional123")
    h_sup = login_headers("supervisor@example.com", "supervisor123")
    h_op = login_headers("operator@example.com", "operator123")
    h_out = login_headers("john@example.com", "employee123")
    h_mnt = login_headers("maintenance@example.com", "maint123")

    # 1. Operator cannot create tasks, create users, log maintenance, or resolve abnormalities
    assert client.post("/api/tasks", headers=h_op, json={"title": "Test"}).status_code == 403
    assert client.post("/api/users", headers=h_op, json={"name": "X", "email": "x@x.com", "password": "123"}).status_code == 403
    assert client.post("/api/ps032/maintenance", headers=h_op, json={"machine_id": "mch-chn-103", "summary": "Test"}).status_code == 403
    assert client.patch("/api/ps032/abnormalities/1", headers=h_op, json={"status": "resolved"}).status_code == 403

    # Outgoing operator cannot acknowledge their own handover
    assert (
        client.post(
            "/api/ps032/handovers/HO-CHN-103-INITIAL/acknowledge",
            headers=h_out,
            json={"remarks": "Self-ack", "condition_confirmed": True},
        ).status_code
        == 403
    )

    # 2. Maintenance Engineer can log maintenance & resolve abnormalities, but cannot create tasks, users, or production entries
    assert (
        client.post(
            "/api/ps032/maintenance",
            headers=h_mnt,
            json={"machine_id": "mch-chn-103", "maintenance_type": "corrective", "status": "in_progress", "summary": "Check seal"},
        ).status_code
        == 201
    )
    assert client.post("/api/ps032/production", headers=h_mnt, json={"machine_id": "mch-chn-103", "units_produced": 10}).status_code == 403
    assert client.post("/api/tasks", headers=h_mnt, json={"title": "Task"}).status_code == 403

    # 3. Factory Supervisor & Regional Manager can create tasks and users, but cannot delete users (Company Admin only)
    t_res = client.post(
        "/api/tasks",
        headers=h_sup,
        json={"title": "Calibrate Torque Gun", "machine_id": "mch-chn-103", "assigned_to": 4},
    )
    assert t_res.status_code == 201
    assert client.delete("/api/users/4", headers=h_sup).status_code == 403
    assert client.delete("/api/users/4", headers=h_reg).status_code == 403

    # 4. Company Admin can create & update users
    u_res = client.post(
        "/api/users",
        headers=h_admin,
        json={"name": "Line Inspector", "email": "inspector@example.com", "password": "pass123", "role": "operator"},
    )
    assert u_res.status_code == 201
    new_uid = u_res.json()["id"]
    assert client.put(f"/api/users/{new_uid}", headers=h_sup, json={"name": "Blocked"}).status_code == 403
    assert client.put(f"/api/users/{new_uid}", headers=h_admin, json={"name": "Line Inspector II"}).status_code == 200

    # Global search works for Supervisor
    search = client.get("/api/search?q=MCH-103", headers=h_sup).json()
    assert len(search["machines"]) == 1
    assert search["machines"][0]["code"] == "MCH-103"


def test_handover_pdf_content_and_headers():
    """Verify A4 handover PDF contains all required industrial sections and valid headers."""
    import base64
    import re
    import zlib

    client = _create_client()
    out_tok = client.post("/api/login", json={"email": "john@example.com", "password": "employee123"}).json()["access_token"]
    h_out = {"Authorization": f"Bearer {out_tok}"}

    # Generate handover for a machine with no abnormalities/maintenance yet (MCH-401)
    ho = client.post("/api/ps032/handovers/generate", headers=h_out, json={"machine_id": "mch-str-401"})
    assert ho.status_code == 201
    pdf_name = ho.json()["pdf_filename"]

    dl = client.get(f"/api/download/{pdf_name}")
    assert dl.status_code == 200
    assert dl.headers["content-type"] == "application/pdf"
    assert "attachment" in dl.headers.get("content-disposition", "")
    assert dl.content.startswith(b"%PDF-")

    inline = client.get(f"/api/download/{pdf_name}?inline=true")
    assert inline.status_code == 200
    assert "inline" in inline.headers.get("content-disposition", "")

    # Decompress ReportLab ASCII85+Flate streams & verify rendered strings inside PDF
    streams = re.findall(b"stream[\r\n]+(.*?)endstream", dl.content, re.S)
    extracted = []
    for s in streams:
        raw = s.strip()
        try:
            if raw.endswith(b"~>"):
                extracted.append(zlib.decompress(base64.a85decode(raw, adobe=True)).decode("latin1", errors="replace"))
            else:
                extracted.append(zlib.decompress(raw).decode("latin1", errors="replace"))
        except Exception:
            extracted.append(raw.decode("latin1", errors="replace"))
    full_pdf_ops = "\n".join(extracted)
    for expected in [
        "PS-032 INDUSTRIAL SHIFT HANDOVER REPORT",
        "1. MACHINE & SHIFT INFORMATION",
        "2. OPERATIONAL SUMMARY",
        "3. ABNORMALITIES & FAULT LOG",
        "4. MAINTENANCE & 5S VERIFICATION",
        "5. HANDOVER NOTES & INCOMING OPERATOR ACKNOWLEDGEMENT",
        "MCH-401",
        "No records available",
        "Page 1 of",
    ]:
        assert expected in full_pdf_ops, f"Missing PDF text: {expected}"


def test_simulation_lifecycle_and_selected_machine_fault():
    """Verify Start/Pause/Resume/Stop/Reset and selected-machine fault & recovery."""
    client = _create_client()

    # Start -> Pause -> Resume -> Stop -> Reset
    s1 = client.post("/api/dt/simulation/start")
    assert s1.status_code == 200
    assert s1.json()["state"] == "running"
    assert s1.json()["ticks_emitted"] >= 1
    assert s1.json()["simulated_machines_count"] == 23

    # Repeated start must not reset or fail
    s1_dup = client.post("/api/dt/simulation/start")
    assert s1_dup.status_code == 200
    assert s1_dup.json()["running"] is True

    p = client.post("/api/dt/simulation/pause")
    assert p.status_code == 200 and p.json()["state"] == "paused" and p.json()["paused"] is True

    r = client.post("/api/dt/simulation/resume")
    assert r.status_code == 200 and r.json()["state"] == "running"

    st = client.post("/api/dt/simulation/stop")
    assert st.status_code == 200 and st.json()["state"] == "stopped"

    # Fault & recover on a selected non-default machine (mch-chn-102)
    f = client.post("/api/dt/simulation/fault", json={"machine_id": "mch-chn-102", "fault_code": "E-777"})
    assert f.status_code == 200 and f.json()["machine_id"] == "mch-chn-102"
    m102 = client.get("/api/dt/machines/mch-chn-102").json()
    assert m102["state"]["status"] == "Fault" and m102["state"]["active_fault_code"] == "E-777"

    rec = client.post("/api/dt/simulation/recover", json={"machine_id": "mch-chn-102"})
    assert rec.status_code == 200
    m102_rec = client.get("/api/dt/machines/mch-chn-102").json()
    assert m102_rec["state"]["status"] == "Running" and m102_rec["state"]["active_fault_code"] is None

    # Reset simulation cleanly
    rst = client.post("/api/dt/simulation/reset")
    assert rst.status_code == 200 and rst.json()["ticks_emitted"] == 0

