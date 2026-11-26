"""WebSocket synchronization test verifying telemetry ingestion broadcasts live updates."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import create_app
from app.seed import seed_database_if_empty


def test_websocket_receives_telemetry_broadcast():
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
    client = TestClient(app)

    with client.websocket_connect("/ws/digital-twin") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "connected"

        # Trigger telemetry batch via REST (same path used by simulator/simulator.py)
        resp = client.post(
            "/api/dt/telemetry/batch",
            json={
                "items": [
                    {
                        "machine_id": "mch-chn-102",
                        "status": "Running",
                        "temperature_c": 60.4,
                        "vibration_mm_s": 2.1,
                        "production_delta": 2,
                        "data_source": "simulation",
                    }
                ]
            },
        )
        assert resp.status_code == 200

        msg = ws.receive_json()
        assert msg["type"] == "telemetry_batch"
        assert msg["payload"]["updates"][0]["machine_id"] == "mch-chn-102"
        assert msg["payload"]["updates"][0]["state"]["temperature_c"] == 60.4

