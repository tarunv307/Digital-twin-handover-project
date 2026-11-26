"""Tests for timezone-aware regional & midnight-crossing shift engine."""

from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.seed import seed_database_if_empty
from app.services.shift_engine import resolve_shift_context, simulate_shift_transition


def _make_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    db = Session()
    seed_database_if_empty(db)
    return db


def test_regional_timezones_and_midnight_crossing():
    db = _make_session()
    try:
        # 2026-11-26 18:00 UTC ->
        # Asia/Kolkata (+05:30) = 23:30 (Night Shift 22:00-06:00, crosses midnight)
        # Europe/Berlin (+01:00) = 19:00 (Spätschicht 14:30-22:30)
        # America/Chicago (-06:00) = 12:00 (Day Shift 07:00-19:00)
        ref_utc = datetime(2026, 11, 26, 18, 0, tzinfo=timezone.utc)

        ind = resolve_shift_context(db, "reg-south-india", at_utc=ref_utc)
        assert ind.timezone == "Asia/Kolkata"
        assert ind.current_shift is not None
        assert ind.current_shift.shift_name == "Night Shift"
        assert ind.current_shift.crosses_midnight is True
        assert ind.previous_shift is not None
        assert ind.previous_shift.shift_name == "Evening Shift"
        assert ind.upcoming_shift is not None
        assert ind.upcoming_shift.shift_name == "Morning Shift"

        emea = resolve_shift_context(db, "reg-emea-de", at_utc=ref_utc)
        assert emea.timezone == "Europe/Berlin"
        assert emea.current_shift is not None
        assert "Spätschicht" in emea.current_shift.shift_name
        assert emea.current_shift.crosses_midnight is False

        na = resolve_shift_context(db, "reg-na-mw", at_utc=ref_utc)
        assert na.timezone == "America/Chicago"
        assert na.current_shift is not None
        assert na.current_shift.shift_name == "Day Shift (12h)"
        assert na.current_shift.duration_hours == 12.0
    finally:
        db.close()


def test_shift_transition_marks_handovers_pending():
    db = _make_session()
    try:
        res = simulate_shift_transition(db, region_id="reg-emea-de")
        assert res["region_id"] == "reg-emea-de"
        assert res["machines_flagged_pending"] == 5
    finally:
        db.close()

