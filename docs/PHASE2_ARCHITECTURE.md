# Phase 2 Architecture Decision — Integrating `Handover-note` into PS-032 Digital Twin

## 1. Source Inspection Summary (`github.com/tarunv307/Handover-note`)

The existing `Handover-note` (ShiftOps) repository provides:
- **Flask + SQLAlchemy Backend (`backend/app.py`, `models.py`)**: User accounts (`User`), password hashing (`werkzeug.security`), role-based access (`admin`, `employee`), task assignment & `.zip`/link submissions (`Task`, `Submission`), and global search (`/api/search`).
- **3-Stage Grounded Shift Handover Engine (`fetch_activity.py`, `generator.py`, `publisher.py`)**:
  - Stage 1: Timezone-aware shift window filtering and UTC normalization.
  - Stage 2: Record deduplication (`(source, record_id)`), progression tracking, deterministic 4-section classification (`Completed`, `In Progress`, `Blockers/Escalations`, `Watch-List`), grounded summary, and Markdown formatting.
  - Stage 3: Single-file ReportLab PDF export (`publish_pdf`).
- **Flutter Application (`frontend_flutter/`)**: Multi-screen mobile app with `ApiService` (remote API + offline fallback) and `AppProvider`.

## 2. Backend Consolidation Decision

Rather than running separate Flask (`:5050`) and FastAPI (`:8000`) servers with two disconnected SQLite databases:

- **Unified FastAPI + SQLAlchemy Core:** FastAPI (`backend/app/main.py`) remains the single authoritative server and database (`digital_twin.db`), preserving all Phase 1 Digital Twin models, WebSockets, shift schedule engine, and Python simulator.
- **Preserved Business Logic:** The `Handover-note` password hashing, user/task/submission workflows, global search, and 3-stage grounded handover generator + ReportLab PDF publisher are modularized directly into `backend/app/services/` (`auth_service.py`, `handover_pipeline.py`, `operations_service.py`, `ps032_adapter.py`).
- **Backward-Compatible & Extended Endpoints:** Existing `Handover-note` API shapes (`/api/login`, `/api/logout`, `/api/me`, `/api/users`, `/api/tasks`, `/api/search`, `/api/generate`, `/api/download/{id}`) are exposed alongside the Digital Twin (`/api/dt/*`) and PS-032 industrial operational APIs (`/api/ps032/*`).

## 3. Domain Transformation Mapping

| `Handover-note` Concept | PS-032 Industrial Concept | Database Model |
| --- | --- | --- |
| `User` (`admin`, `employee`) | Factory Personnel (`company_admin`, `regional_manager`, `factory_supervisor`, `operator`, `maintenance_engineer`) | `UserAccount` (`ps032_users`) |
| `Task` & `Submission` | Machine/Production Task & Verification Artifact | `MachineTask` (`ps032_tasks`), `TaskSubmission` (`ps032_submissions`) |
| IT Incident (`incidents.json`) | Machine Abnormality linked to `Machine` & `Shift` | `Abnormality` (`ps032_abnormalities`) |
| Shift Notes / Chat | Cleaning & 5S Verification Logs | `Cleaning5SLog` (`ps032_cleaning_logs`) |
| Operational Metrics | Shift Production Entry (Actual, Rejects, Downtime, OEE) | `ProductionEntry` (`ps032_production_entries`) |
| Maintenance Tracking | Machine Maintenance Record | `MaintenanceRecord` (`ps032_maintenance_records`) |
| Generated Shift Note + PDF | Machine-Wise Shift Handover Record + Acknowledgement | `HandoverRecord` (`ps032_handover_records`) |
| System Traceability | Immutable Industrial Audit Trail | `AuditEvent` (`ps032_audit_events`) |

