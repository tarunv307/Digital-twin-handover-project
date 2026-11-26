"""Comprehensive tests for PS-032 Expansion Features (1-10) & Strict Machine/Shift RBAC."""

from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
import app.models_ps032  # noqa: F401
from app.seed import seed_database_if_empty
from app.seed_ps032 import seed_ps032_if_empty


def _client() -> TestClient:
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


def _login_headers(client: TestClient, email: str, password: str) -> dict[str, str]:
    res = client.post("/api/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_all_ten_industrial_features_and_analytics():
    client = _client()
    h_admin = _login_headers(client, "admin@example.com", "admin123")
    h_sup = _login_headers(client, "supervisor@example.com", "supervisor123")
    h_out = _login_headers(client, "john@example.com", "employee123")
    h_mnt = _login_headers(client, "maintenance@example.com", "maint123")

    # Feature 1: Production Target vs Actual
    prod = client.post(
        "/api/ps032/production",
        headers=h_out,
        json={
            "machine_id": "mch-chn-103",
            "shift_name": "Morning Shift",
            "units_produced": 150,
            "target_units": 160,
            "reject_units": 5,
            "downtime_minutes": 4.0,
            "remarks": "Batch 99 verified",
        },
    )
    assert prod.status_code == 201, prod.text

    # Feature 2: Downtime Open & Close + OEE Impact
    dt_open = client.post(
        "/api/ps032/downtime",
        headers=h_out,
        json={
            "machine_id": "mch-chn-103",
            "category": "unplanned",
            "reason_category": "tooling",
            "reason_detail": "Boring bar insert chipped mid-cycle",
        },
    )
    assert dt_open.status_code == 201, dt_open.text
    dt_id = dt_open.json()["id"]
    assert dt_open.json()["status"] == "open"

    dt_close = client.patch(
        f"/api/ps032/downtime/{dt_id}",
        headers=h_out,
        json={"status": "closed", "duration_minutes": 14.5},
    )
    assert dt_close.status_code == 200
    assert dt_close.json()["status"] == "closed"
    assert dt_close.json()["duration_minutes"] == 14.5

    # Feature 3: Safety Checklist Critical Escalation + Supervisor Review
    saf_fail = client.post(
        "/api/ps032/safety-checklists",
        headers=h_out,
        json={
            "machine_id": "mch-chn-103",
            "items": [
                {"key": "estop", "label": "E-Stop Test", "response": "fail", "critical": True},
                {"key": "ppe", "label": "Operator PPE", "response": "pass", "critical": False},
            ],
            "operator_remarks": "E-stop button stuck",
        },
    )
    assert saf_fail.status_code == 201, saf_fail.text
    chk_data = saf_fail.json()
    assert chk_data["has_critical_failure"] is True
    assert chk_data["overall_status"] == "critical_fail"
    assert chk_data["escalated_abnormality_id"] is not None

    # Confirm machine state became Fault from critical safety fail
    m_detail = client.get("/api/dt/machines/mch-chn-103", headers=h_sup).json()
    assert m_detail["state"]["status"] == "Fault"

    # Recover machine & Supervisor approves safety review
    assert client.post("/api/dt/simulation/recover", json={"machine_id": "mch-chn-103"}).status_code == 200
    rev = client.patch(
        f"/api/ps032/safety-checklists/{chk_data['id']}/review",
        headers=h_sup,
        json={"supervisor_review_status": "reviewed", "supervisor_notes": "Replaced E-stop mushroom."},
    )
    assert rev.status_code == 200
    assert rev.json()["supervisor_review_status"] == "reviewed"

    # Feature 4: Preventive Maintenance Planner (including Overdue & Complete -> MaintenanceRecord)
    past_due = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    pm_create = client.post(
        "/api/ps032/maintenance-schedules",
        headers=h_mnt,
        json={
            "machine_id": "mch-chn-103",
            "title": "Coolant Pump Seal PM",
            "maintenance_type": "preventive",
            "frequency_days": 30,
            "due_date": past_due,
        },
    )
    assert pm_create.status_code == 201, pm_create.text
    pm_id = pm_create.json()["id"]
    assert pm_create.json()["is_overdue"] is True

    pm_done = client.patch(
        f"/api/ps032/maintenance-schedules/{pm_id}",
        headers=h_mnt,
        json={"status": "completed", "inspection_notes": "Seal replaced cleanly."},
    )
    assert pm_done.status_code == 200
    assert pm_done.json()["status"] == "completed"
    assert pm_done.json()["is_overdue"] is False
    assert pm_done.json()["linked_record_id"] is not None

    # Feature 5: Quality & Defect Management
    qi = client.post(
        "/api/ps032/quality",
        headers=h_out,
        json={
            "machine_id": "mch-chn-103",
            "inspected_qty": 80,
            "rejected_qty": 2,
            "reworked_qty": 3,
            "defect_category": "dimensional",
            "remarks": "CMM bore tolerance audit",
        },
    )
    assert qi.status_code == 201, qi.text

    # Feature 6: Smart Shift Roster
    roster = client.get("/api/ps032/shift-roster", headers=h_sup)
    assert roster.status_code == 200
    r_json = roster.json()
    assert len(r_json["assignments"]) >= 1
    assert len(r_json["regional_shifts"]) >= 1

    # Feature 7: Machine Health Score (explainable estimate)
    health = client.get("/api/ps032/machines/mch-chn-103/health", headers=h_out)
    assert health.status_code == 200
    h_json = health.json()
    assert 0 <= h_json["score"] <= 100
    assert h_json["is_estimated"] is True
    assert "disclaimer" in h_json

    # Feature 8: Energy Monitoring (explicit simulation flag)
    energy = client.get("/api/ps032/machines/mch-chn-103/energy", headers=h_out)
    assert energy.status_code == 200
    e_json = energy.json()
    assert e_json["is_simulated"] is True
    assert e_json["estimated_shift_kwh"] >= 0

    # Feature 9: QR Machine Passport
    passport = client.get("/api/ps032/passport/QR-MCH-103", headers=h_out)
    assert passport.status_code == 200
    p_json = passport.json()
    assert p_json["machine"]["code"] == "MCH-103"
    assert p_json["production_summary"]["total_units"] >= 150

    # Feature 10: Factory Performance Analytics & Filters
    ana_shift = client.get(
        "/api/ps032/analytics",
        headers=h_admin,
        params={"region_id": "reg-south-india", "factory_id": "fac-chn-a", "shift_name": "Morning Shift"},
    )
    assert ana_shift.status_code == 200
    assert len(ana_shift.json()["shift_production_summary"]) >= 1

    ana = client.get(
        "/api/ps032/analytics",
        headers=h_admin,
        params={"region_id": "reg-south-india", "factory_id": "fac-chn-a"},
    )
    assert ana.status_code == 200
    a_json = ana.json()
    assert a_json["kpis"]["total_downtime_min"] >= 14.5
    assert any(d["reason_category"] == "tooling" for d in a_json["top_downtime_causes"])
    assert any(q["defect_category"] == "dimensional" for q in a_json["quality_by_category"])


def test_strict_rbac_and_dynamic_operator_assignment_scenario():
    client = _client()
    h_admin = _login_headers(client, "admin@example.com", "admin123")
    h_sup = _login_headers(client, "supervisor@example.com", "supervisor123")
    h_mnt = _login_headers(client, "maintenance@example.com", "maint123")

    # 1. Admin creates Operator A scoped to Factory Chennai A
    create_u = client.post(
        "/api/users",
        headers=h_admin,
        json={
            "name": "Operator Alpha",
            "email": "op_a@example.com",
            "password": "alpha123",
            "role": "operator",
            "employee_id": "OP-ALPHA",
            "assigned_region_id": "reg-south-india",
            "assigned_factory_id": "fac-chn-a",
        },
    )
    assert create_u.status_code == 201, create_u.text
    op_a_id = create_u.json()["id"]

    # Before any assignment, Operator A sees 0 machines and gets 403 on MCH-103
    h_op_a = _login_headers(client, "op_a@example.com", "alpha123")
    assert len(client.get("/api/ps032/my-machines", headers=h_op_a).json()["machines"]) == 0
    assert client.get("/api/ps032/machines/mch-chn-103/workspace", headers=h_op_a).status_code == 403

    # 2. Admin assigns Operator A ONLY to MCH-103 on Morning Shift
    assign_res = client.post(
        "/api/ps032/assignments",
        headers=h_admin,
        json={
            "user_id": op_a_id,
            "machine_id": "mch-chn-103",
            "shift_name": "Morning Shift",
            "notes": "Test assignment workflow",
        },
    )
    assert assign_res.status_code == 201, assign_res.text
    assign_id = assign_res.json()["id"]

    # 3. Operator A logs in & checks My Machines -> ONLY mch-chn-103
    my_m = client.get("/api/ps032/my-machines", headers=h_op_a)
    assert my_m.status_code == 200
    assert [m["id"] for m in my_m.json()["machines"]] == ["mch-chn-103"]

    # 4. Operator A tries accessing unassigned Machine MCH-102 via URL, QR, workspace, POST -> ALL 403!
    assert client.get("/api/dt/machines/mch-chn-102", headers=h_op_a).status_code == 403
    assert client.get("/api/dt/machines/by-qr/QR-MCH-102", headers=h_op_a).status_code == 403
    assert client.get("/api/ps032/passport/QR-MCH-102", headers=h_op_a).status_code == 403
    assert client.get("/api/ps032/machines/mch-chn-102/workspace", headers=h_op_a).status_code == 403
    assert (
        client.post(
            "/api/ps032/production",
            headers=h_op_a,
            json={"machine_id": "mch-chn-102", "units_produced": 10},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/ps032/abnormalities",
            headers=h_op_a,
            json={"machine_id": "mch-chn-102", "title": "Leak", "description": "Oil", "severity": "low"},
        ).status_code
        == 403
    )

    # 5. Operator A submits production & abnormality on assigned MCH-103 -> succeeds!
    assert (
        client.post(
            "/api/ps032/production",
            headers=h_op_a,
            json={"machine_id": "mch-chn-103", "units_produced": 120, "reject_units": 0},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/ps032/abnormalities",
            headers=h_op_a,
            json={"machine_id": "mch-chn-103", "title": "Chip buildup", "description": "Conveyor", "severity": "low"},
        ).status_code
        == 201
    )
    my_rep = client.get("/api/ps032/my-reports", headers=h_op_a).json()
    assert len(my_rep["production_entries"]) == 1
    assert any(a["machine_id"] == "mch-chn-103" for a in my_rep["abnormalities"])

    # 6. Operator A cannot assign machines, create admins, or open supervisor analytics outside scope
    assert (
        client.post(
            "/api/ps032/assignments",
            headers=h_op_a,
            json={"user_id": op_a_id, "machine_id": "mch-chn-102"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/users",
            headers=h_op_a,
            json={"name": "Fake Admin", "email": "fake@x.com", "password": "123", "role": "company_admin"},
        ).status_code
        == 403
    )
    assert client.get("/api/ps032/analytics", headers=h_op_a, params={"factory_id": "fac-hsr-b"}).status_code == 403

    # Supervisor of fac-chn-a cannot view fac-hsr-b or create company_admin
    assert client.get("/api/dt/factories/fac-hsr-b", headers=h_sup).status_code == 403
    assert (
        client.post(
            "/api/users",
            headers=h_sup,
            json={"name": "Bad", "email": "bad@x.com", "password": "123", "role": "company_admin"},
        ).status_code
        == 403
    )
    # Maintenance engineer cannot enter production
    assert (
        client.post(
            "/api/ps032/production",
            headers=h_mnt,
            json={"machine_id": "mch-chn-103", "units_produced": 50},
        ).status_code
        == 403
    )
    # Wrong-shift operator cannot acknowledge HO-CHN-103-INITIAL (which expects Evening Shift & M. Priya)
    assert (
        client.post(
            "/api/ps032/handovers/HO-CHN-103-INITIAL/acknowledge",
            headers=h_op_a,
            json={"remarks": "Wrong shift ack", "condition_confirmed": True},
        ).status_code
        == 403
    )

    # 7. Admin removes Operator A's assignment -> Operator A loses MCH-103 access IMMEDIATELY
    del_assign = client.delete(f"/api/ps032/assignments/{assign_id}", headers=h_admin)
    assert del_assign.status_code == 200
    assert client.get("/api/ps032/machines/mch-chn-103/workspace", headers=h_op_a).status_code == 403
    assert client.get("/api/ps032/passport/QR-MCH-103", headers=h_op_a).status_code == 403
    assert (
        client.post(
            "/api/ps032/production",
            headers=h_op_a,
            json={"machine_id": "mch-chn-103", "units_produced": 10},
        ).status_code
        == 403
    )

    # 8. Admin deactivates Operator A -> login denied cleanly with 403
    assert client.put(f"/api/users/{op_a_id}", headers=h_admin, json={"is_active": False}).status_code == 200
    deact_login = client.post("/api/login", json={"email": "op_a@example.com", "password": "alpha123"})
    assert deact_login.status_code == 403

    # 9. Audit trail captured assignment create, remove, and operator submission
    audit = client.get("/api/ps032/audit", headers=h_admin, params={"limit": 50}).json()
    actions = {ev["action"] for ev in audit}
    assert "operator_assigned" in actions
    assert "assignment_removed" in actions
    assert "production_recorded" in actions


def test_hierarchy_display_names_and_role_scoped_tree():
    from app.database import SessionLocal
    from app.models import Factory
    from app.seed import ensure_hierarchy_display_names

    client = _client()
    h_admin = _login_headers(client, "admin@example.com", "admin123")
    h_reg = _login_headers(client, "regional@example.com", "regional123")
    h_sup = _login_headers(client, "supervisor@example.com", "supervisor123")
    h_out = _login_headers(client, "john@example.com", "employee123")
    h_mnt = _login_headers(client, "maintenance@example.com", "maint123")

    # 1. Verify all 3 regions & 4 unique factory names + idempotent migration
    admin_tree = client.get("/api/dt/hierarchy", headers=h_admin).json()
    assert admin_tree["name"] == "Apex Precision Manufacturing"
    region_names = {r["name"] for r in admin_tree["regions"]}
    assert region_names == {"South Region", "North Region", "West Region"}

    fac_by_region = {r["name"]: {f["name"] for f in r["factories"]} for r in admin_tree["regions"]}
    assert fac_by_region["South Region"] == {
        "Coimbatore Precision Works",
        "Mysuru Advanced Components Plant",
    }
    assert fac_by_region["North Region"] == {"Gurugram Industrial Systems"}
    assert fac_by_region["West Region"] == {"Pune Motion Technologies"}
    assert admin_tree["summary"]["total_machines"] == 23

    # Verify Regional Manager sees ONLY South Region
    reg_tree = client.get("/api/dt/hierarchy", headers=h_reg).json()
    assert [r["name"] for r in reg_tree["regions"]] == ["South Region"]

    # Verify Factory Supervisor sees ONLY Coimbatore Precision Works
    sup_tree = client.get("/api/dt/hierarchy", headers=h_sup).json()
    assert len(sup_tree["regions"]) == 1
    assert [f["name"] for f in sup_tree["regions"][0]["factories"]] == ["Coimbatore Precision Works"]

    # Verify Operator sees ONLY actively assigned machines (no unassigned fac-chn-a machine mch-chn-102)
    op_tree = client.get("/api/dt/hierarchy", headers=h_out).json()
    op_machine_ids = {
        m["id"]
        for r in op_tree["regions"]
        for f in r["factories"]
        for l in f["production_lines"]
        for m in l["machines"]
    }
    assert "mch-chn-103" in op_machine_ids
    assert "mch-chn-102" not in op_machine_ids

    # Verify Maintenance Engineer sees ONLY maintenance-scoped machines
    mnt_tree = client.get("/api/dt/hierarchy", headers=h_mnt).json()
    mnt_machine_ids = {
        m["id"]
        for r in mnt_tree["regions"]
        for f in r["factories"]
        for l in f["production_lines"]
        for m in l["machines"]
    }
    assert mnt_machine_ids == {"mch-chn-103", "mch-chn-202", "mch-hsr-303"}

    # 2. Verify accurate Indian city coordinates & maintenance summary counts
    admin_factories = {
        f["id"]: f
        for r in admin_tree["regions"]
        for f in r["factories"]
    }
    assert admin_factories["fac-chn-a"]["latitude"] == pytest.approx(11.0168, abs=1e-4)
    assert admin_factories["fac-chn-a"]["longitude"] == pytest.approx(76.9558, abs=1e-4)
    assert admin_factories["fac-chn-a"]["location_label"] == "Coimbatore, Tamil Nadu"
    assert admin_factories["fac-hsr-b"]["latitude"] == pytest.approx(12.2958, abs=1e-4)
    assert admin_factories["fac-hsr-b"]["longitude"] == pytest.approx(76.6394, abs=1e-4)
    assert admin_factories["fac-hsr-b"]["location_label"] == "Mysuru, Karnataka"
    assert admin_factories["fac-str-c"]["latitude"] == pytest.approx(28.4595, abs=1e-4)
    assert admin_factories["fac-str-c"]["longitude"] == pytest.approx(77.0266, abs=1e-4)
    assert admin_factories["fac-str-c"]["location_label"] == "Gurugram, Haryana"
    assert admin_factories["fac-dtw-d"]["latitude"] == pytest.approx(18.5204, abs=1e-4)
    assert admin_factories["fac-dtw-d"]["longitude"] == pytest.approx(73.8567, abs=1e-4)
    assert admin_factories["fac-dtw-d"]["location_label"] == "Pune, Maharashtra"
    assert "open_maintenance_orders" in admin_tree["summary"]
    assert "overdue_maintenance_orders" in admin_tree["summary"]

    # Regional manager sees coordinates only for South Region plants
    reg_fac_ids = {f["id"] for r in reg_tree["regions"] for f in r["factories"]}
    assert reg_fac_ids == {"fac-chn-a", "fac-hsr-b"}
    # Supervisor sees coordinates only for Coimbatore Precision Works
    sup_fac_ids = {f["id"] for r in sup_tree["regions"] for f in r["factories"]}
    assert sup_fac_ids == {"fac-chn-a"}


def test_personnel_directory_individual_profiles_and_factory_ops():
    client = _client()
    assert client.get("/api/ps032/personnel").status_code == 401
    assert client.get("/api/ps032/personnel/1").status_code == 401

    h_admin = _login_headers(client, "admin@example.com", "admin123")
    h_reg = _login_headers(client, "regional@example.com", "regional123")
    h_sup = _login_headers(client, "supervisor@example.com", "supervisor123")
    h_john = _login_headers(client, "john@example.com", "employee123")
    h_priya = _login_headers(client, "operator@example.com", "operator123")

    # 1. Admin searches personnel by machine, factory, region, and employee ID / name
    all_people = client.get("/api/ps032/personnel", headers=h_admin)
    assert all_people.status_code == 200
    rows = all_people.json()
    assert len(rows) >= 5

    john_row = next(r for r in rows if r["email"] == "john@example.com")
    priya_row = next(r for r in rows if r["email"] == "operator@example.com")

    mch_filtered = client.get("/api/ps032/personnel?machine_id=mch-chn-103", headers=h_admin).json()
    assert any(r["id"] == john_row["id"] for r in mch_filtered)

    if john_row["employee_id"]:
        emp_search = client.get(f"/api/ps032/personnel?q={john_row['employee_id']}", headers=h_admin).json()
        assert len(emp_search) == 1
        assert emp_search[0]["id"] == john_row["id"]

    # 2. Admin fetches ONE operator's individual profile with real assignments, machines, and reports
    john_profile = client.get(f"/api/ps032/personnel/{john_row['id']}", headers=h_admin)
    assert john_profile.status_code == 200
    jp = john_profile.json()
    assert jp["user"]["id"] == john_row["id"]
    assert jp["assignment_status"] == "Active"
    assert jp["audit_authorized"] is True
    assert any(m["id"] == "mch-chn-103" for m in jp["assigned_machines"])
    assert len(jp["assignments"]) >= 1
    assert isinstance(jp["recent_production_reports"], list)
    assert isinstance(jp["handover_records"], list)

    # 3. Operator sees ONLY themselves and cannot inspect Priya's individual profile or unassigned factory
    john_self_list = client.get("/api/ps032/personnel", headers=h_john).json()
    assert [u["id"] for u in john_self_list] == [john_row["id"]]
    assert client.get(f"/api/ps032/personnel/{john_row['id']}", headers=h_john).status_code == 200
    assert client.get(f"/api/ps032/personnel/{priya_row['id']}", headers=h_john).status_code == 403
    assert client.get("/api/ps032/personnel?factory_id=fac-dtw-d", headers=h_john).status_code == 403
    assert client.get(f"/api/ps032/personnel/{john_row['id']}", headers=h_priya).status_code == 403

    # 4. Supervisor scoped to Coimbatore Precision Works (fac-chn-a) only
    assert client.get("/api/ps032/personnel?factory_id=fac-hsr-b", headers=h_sup).status_code == 403
    sup_list = client.get("/api/ps032/personnel?factory_id=fac-chn-a", headers=h_sup).json()
    assert all(
        (u["assigned_factory_id"] == "fac-chn-a" or any(m["id"].startswith("mch-chn") for m in u["assigned_machines"]))
        for u in sup_list
    )

    # 5. Regional manager cannot filter North Region personnel
    assert client.get("/api/ps032/personnel?region_id=reg-emea-de", headers=h_reg).status_code == 403
    assert client.get("/api/ps032/personnel?region_id=reg-south-india", headers=h_reg).status_code == 200

    # 6. Factory-scoped maintenance endpoints respect factory_id filter & access control
    fac_maint = client.get("/api/ps032/maintenance?factory_id=fac-chn-a", headers=h_sup)
    assert fac_maint.status_code == 200
    assert all(m["factory_id"] == "fac-chn-a" for m in fac_maint.json())
    assert client.get("/api/ps032/maintenance?factory_id=fac-hsr-b", headers=h_sup).status_code == 403
    assert client.get("/api/ps032/maintenance-schedules?factory_id=fac-chn-a", headers=h_sup).status_code == 200
    assert client.get("/api/ps032/maintenance-schedules?factory_id=fac-hsr-b", headers=h_sup).status_code == 403


