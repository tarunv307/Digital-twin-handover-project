"""Comprehensive tests for PS-032 Centralized Reports, Hierarchical Filtering, PDF/ZIP Exports & RBAC."""

from datetime import datetime, timezone
import base64
import io
import re
import zipfile
import zlib
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

    app = create_app()

    def override_get_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    r = client.post("/api/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Decompress ReportLab ASCII85+Flate streams to verify PDF is non-blank with expected text."""
    assert pdf_bytes.startswith(b"%PDF-")
    chunks = []
    for raw in re.findall(rb"stream[\r\n]+(.*?)endstream", pdf_bytes, re.DOTALL):
        s = raw.strip()
        try:
            if s.endswith(b"~>"):
                chunks.append(zlib.decompress(base64.a85decode(s, adobe=True)).decode("latin-1", errors="replace"))
            else:
                chunks.append(zlib.decompress(s).decode("latin-1", errors="replace"))
        except Exception:
            chunks.append(s.decode("latin-1", errors="replace"))
    return "\n".join(chunks)


def test_centralized_reports_filters_preview_downloads_and_non_blank_pdfs():
    client = _client()

    # Unauthenticated blocked
    assert client.get("/api/ps032/reports").status_code == 401

    h_admin = _login(client, "admin@example.com", "admin123")

    # 1. Company-wide catalog & dynamic summary counts
    all_res = client.get("/api/ps032/reports", headers=h_admin)
    assert all_res.status_code == 200
    all_data = all_res.json()
    assert all_data["summary"]["total_reports"] >= 10
    assert all_data["summary"]["factories_covered"] == 4
    assert all_data["summary"]["pending_handovers"] >= 1

    # 2. Region filter (South Region -> Coimbatore & Mysuru only)
    south_res = client.get("/api/ps032/reports", headers=h_admin, params={"region_id": "reg-south-india"})
    assert south_res.status_code == 200
    south_facs = {r["factory_name"] for r in south_res.json()["reports"] if r["factory_id"]}
    assert south_facs <= {"Coimbatore Precision Works", "Mysuru Advanced Components Plant"}

    # 3. Factory, Line & Machine filter
    fac_res = client.get("/api/ps032/reports", headers=h_admin, params={"factory_id": "fac-chn-a"})
    assert fac_res.status_code == 200
    assert all(r["factory_id"] == "fac-chn-a" for r in fac_res.json()["reports"])

    m_res = client.get("/api/ps032/reports", headers=h_admin, params={"machine_id": "mch-chn-103"})
    assert m_res.status_code == 200
    assert all(r["machine_id"] == "mch-chn-103" for r in m_res.json()["reports"])

    # 4. Date & Shift filtering
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    shift_res = client.get(
        "/api/ps032/reports",
        headers=h_admin,
        params={"shift_name": "Morning Shift", "start_date": "2020-01-01", "end_date": today},
    )
    assert shift_res.status_code == 200
    assert len(shift_res.json()["reports"]) >= 1
    assert all(r["shift_name"] == "Morning Shift" for r in shift_res.json()["reports"])

    # Empty date range returns 0 reports and bulk download returns 404 (never blank PDF)
    empty_res = client.get(
        "/api/ps032/reports",
        headers=h_admin,
        params={"start_date": "1999-01-01", "end_date": "1999-01-02"},
    )
    assert empty_res.status_code == 200
    assert empty_res.json()["summary"]["total_reports"] == 0
    assert (
        client.get(
            "/api/ps032/reports/bulk-download",
            headers=h_admin,
            params={"scope": "company", "start_date": "1999-01-01", "end_date": "1999-01-02"},
        ).status_code
        == 404
    )

    # 5. Individual Preview & Individual PDF Download (Handover + Production + Maintenance)
    prev_res = client.get("/api/ps032/reports/preview/shift_handover:HO-CHN-103-INITIAL", headers=h_admin)
    assert prev_res.status_code == 200
    prev_json = prev_res.json()
    assert prev_json["report"]["machine_code"] == "MCH-103"
    assert prev_json["report"]["factory_name"] == "Coimbatore Precision Works"

    pdf_ho = client.get("/api/ps032/reports/download/shift_handover:HO-CHN-103-INITIAL", headers=h_admin)
    assert pdf_ho.status_code == 200
    assert pdf_ho.headers["content-type"] == "application/pdf"
    ho_text = _extract_pdf_text(pdf_ho.content)
    assert "MCH-103" in ho_text
    assert "Coimbatore Precision Works" in ho_text

    # Test dynamic PDF generation on a non-handover report (e.g. production or maintenance)
    mnt_item = next(r for r in all_data["reports"] if r["category"] == "maintenance")
    pdf_mnt = client.get(f"/api/ps032/reports/download/{mnt_item['report_uid']}", headers=h_admin)
    assert pdf_mnt.status_code == 200
    mnt_text = _extract_pdf_text(pdf_mnt.content)
    assert "PS-032" in mnt_text
    assert mnt_item["machine_code"] in mnt_text

    # 6. Consolidated Factory, Region & Company Bulk PDF + ZIP downloads
    bulks = [
        ("factory", {"factory_id": "fac-chn-a", "start_date": "2020-01-01", "end_date": today}, "Coimbatore_Precision_Works"),
        ("region", {"region_id": "reg-south-india", "start_date": "2020-01-01", "end_date": today}, "South_Region"),
        ("company", {"start_date": "2020-01-01", "end_date": today}, "Apex_Precision_Manufacturing"),
    ]
    for scope, extra_params, expected_fname_prefix in bulks:
        res = client.get(
            "/api/ps032/reports/bulk-download",
            headers=h_admin,
            params={"scope": scope, "format": "pdf", **extra_params},
        )
        assert res.status_code == 200, res.text
        assert res.headers["content-type"] == "application/pdf"
        assert expected_fname_prefix in res.headers["content-disposition"]
        txt = _extract_pdf_text(res.content)
        assert f"CONSOLIDATED {scope.upper()} REPORTS" in txt

    # ZIP bundle export check
    zip_res = client.get(
        "/api/ps032/reports/bulk-download",
        headers=h_admin,
        params={"scope": "factory", "format": "zip", "factory_id": "fac-chn-a"},
    )
    assert zip_res.status_code == 200
    assert zip_res.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
        names = zf.namelist()
        assert len(names) >= 2
        assert all(n.endswith(".pdf") for n in names)

    # 7. Verify audit events (view, individual download, PDF bundles, and ZIP export) were recorded
    audit = client.get("/api/ps032/audit", headers=h_admin, params={"limit": 40}).json()
    actions = {a["action"] for a in audit}
    assert "report_viewed" in actions
    assert "report_downloaded_individual" in actions
    assert "factory_report_downloaded" in actions
    assert "region_report_downloaded" in actions
    assert "company_report_downloaded" in actions
    assert "zip_export_downloaded" in actions


def test_reports_role_based_access_restrictions():
    client = _client()
    h_admin = _login(client, "admin@example.com", "admin123")
    h_reg = _login(client, "regional@example.com", "regional123")
    h_sup = _login(client, "supervisor@example.com", "supervisor123")
    h_out = _login(client, "john@example.com", "employee123")
    h_mnt = _login(client, "maintenance@example.com", "maint123")

    # 1. Regional Manager: allowed South Region only (listing, factory/region PDF, ZIP, preview, individual PDF)
    reg_list = client.get("/api/ps032/reports", headers=h_reg)
    assert reg_list.status_code == 200
    assert all(r["region_id"] in (None, "reg-south-india") for r in reg_list.json()["reports"])
    assert (
        client.get(
            "/api/ps032/reports/bulk-download",
            headers=h_reg,
            params={"scope": "region", "region_id": "reg-south-india"},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/ps032/reports/bulk-download",
            headers=h_reg,
            params={"scope": "factory", "factory_id": "fac-chn-a", "format": "zip"},
        ).status_code
        == 200
    )
    assert client.get("/api/ps032/reports/download/shift_handover:HO-CHN-103-INITIAL", headers=h_reg).status_code == 200

    # Regional Manager: blocked from other regions, other factories/machines/lines, and company-wide export
    assert client.get("/api/ps032/reports", headers=h_reg, params={"region_id": "reg-emea-de"}).status_code == 403
    assert client.get("/api/ps032/reports", headers=h_reg, params={"region_id": "reg-na-mw"}).status_code == 403
    assert client.get("/api/ps032/reports", headers=h_reg, params={"factory_id": "fac-str-c"}).status_code == 403
    assert client.get("/api/ps032/reports", headers=h_reg, params={"machine_id": "mch-str-401"}).status_code == 403
    assert client.get("/api/ps032/reports/preview/machine_oee:mch-str-401", headers=h_reg).status_code == 403
    assert client.get("/api/ps032/reports/download/machine_oee:mch-str-401", headers=h_reg).status_code == 403
    assert client.get("/api/ps032/reports/bulk-download", headers=h_reg, params={"scope": "company"}).status_code == 403
    assert (
        client.get(
            "/api/ps032/reports/bulk-download",
            headers=h_reg,
            params={"scope": "region", "region_id": "reg-emea-de"},
        ).status_code
        == 403
    )

    # 2. Factory Supervisor, Operator & Maintenance Engineer: NO Centralized Reports access (all endpoints -> 403)
    for blocked_headers in (h_sup, h_out, h_mnt):
        assert client.get("/api/ps032/reports", headers=blocked_headers).status_code == 403
        assert (
            client.get(
                "/api/ps032/reports/preview/shift_handover:HO-CHN-103-INITIAL",
                headers=blocked_headers,
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/ps032/reports/download/shift_handover:HO-CHN-103-INITIAL",
                headers=blocked_headers,
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/ps032/reports/bulk-download",
                headers=blocked_headers,
                params={"scope": "factory", "factory_id": "fac-chn-a"},
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/ps032/reports/bulk-download",
                headers=blocked_headers,
                params={"scope": "region"},
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/ps032/reports/bulk-download",
                headers=blocked_headers,
                params={"scope": "company"},
            ).status_code
            == 403
        )

    # 3. Verify existing operational workflows (My Reports, Handovers) remain intact for Operators
    assert client.get("/api/ps032/my-reports", headers=h_out).status_code == 200
    assert client.get("/api/ps032/handovers", headers=h_out).status_code == 200

    # 4. Verify unauthorized report access attempts were logged in the audit trail
    audit = client.get("/api/ps032/audit", headers=h_admin, params={"limit": 80}).json()
    unauth_events = [a for a in audit if a["action"] == "unauthorized_report_access_attempt"]
    assert len(unauth_events) >= 4
    unauth_roles = {a["actor_role"] for a in unauth_events}
    assert {"regional_manager", "factory_supervisor", "operator", "maintenance_engineer"} <= unauth_roles
