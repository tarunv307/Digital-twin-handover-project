# PS-032 | Industrial Digital Twin & Smart Shift Handover Platform

The **PS-032 Paperless Digital Shift Data Management System** integrated with an interactive **3D Industrial Digital Twin**, adapting and preserving the core workflows of [Handover-note](https://github.com/tarunv307/Handover-note) inside a unified FastAPI + SQLAlchemy + React Three Fiber + Flutter architecture.

---

## 1. Architecture Overview

See [docs/PHASE2_ARCHITECTURE.md](docs/PHASE2_ARCHITECTURE.md), [docs/PS032_FEATURES.md](docs/PS032_FEATURES.md), and [docs/ROLE_AND_MACHINE_ACCESS.md](docs/ROLE_AND_MACHINE_ACCESS.md) for architecture, the 10 operational modules, and strict RBAC/machine assignment controls.

**Key Web Routes:**
- `/digital-twin` — Company 3D Digital Twin
- `/digital-twin/operator` — Operator & Technician Assigned Machines (auto-landing for operators)
- `/digital-twin/my-reports` — Personal Operational Submissions
- `/digital-twin/users` — Admin/Supervisor User & Machine-Shift Assignment Management
- `/digital-twin/analytics` — Factory Performance Analytics, Shift Roster & PM Planner
- `/digital-twin/qr/:qrToken` — Printable QR Machine Passport

```text
simulator/simulator.py ──(POST /api/dt/telemetry/batch)──┐
                                                          ▼
In-process SimulationController ─▶ FastAPI + SQLAlchemy (digital_twin.db)
                                     ├── Digital Twin (/api/dt/*, /ws/digital-twin)
                                     ├── Auth & RBAC (/api/login, /api/users, /api/search)
                                     ├── Industrial Ops (/api/ps032/production, abnormalities,
                                     │                   maintenance, cleaning, tasks, audit)
                                     └── 3-Stage Handover + ReportLab PDF
                                          (/api/ps032/handovers/*, /api/download/*)
                                          │
                      ┌───────────────────┴───────────────────┐
                      ▼                                       ▼
    React + Three.js Web Twin (frontend/)       Flutter Mobile App (mobile_flutter/)
```

---

## 2. Backend & Frontend Setup

### Prerequisites
- Python 3.11+ (`uv` or `venv`)
- Node.js 20+ & `npm`

### Backend Setup & Launch
```bash
cd backend
uv venv .venv
uv pip install -e . --python .venv/bin/python
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Frontend Setup & Launch
```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```
Open **`http://127.0.0.1:5173/digital-twin`** in your browser. Vite proxies `/api/*` and `/ws/*` to `http://127.0.0.1:8000`.

### Optional External Python Simulator
```bash
backend/.venv/bin/python simulator/simulator.py --url http://127.0.0.1:8000 --interval 2.0
```

---

## 3. Database Initialization & Seeding

- On startup, FastAPI lifespan runs `Base.metadata.create_all(bind=engine)` against `DT_DATABASE_URL` (defaults to `sqlite:///./digital_twin.db` in `backend/`).
- `seed_database_if_empty(db)` populates the Digital Twin hierarchy: **1** company (`Apex Precision Manufacturing Corp.`), **3** timezone-distinct regions (`Asia/Kolkata`, `Europe/Berlin`, `America/Chicago`), **4** factories, **5** production lines, **23** ordered machines with DB-backed specifications, and regional shift schedules (including midnight-crossing shifts).
- `seed_ps032_if_empty(db)` populates industrial personnel accounts, abnormalities, maintenance logs, production & 5S records, tasks, audit events, and initial pending shift handover `HO-CHN-103-INITIAL` (with exported PDF).
- To reset to a clean seeded state: remove `backend/digital_twin.db` and restart `uvicorn`.

---

## 4. Demo Login Instructions (Local Demonstration Only)

Click **Operator Sign-In** in the top navigation bar (or switch roles at any time via the active user pill).

| Industrial Role | Email | Password | Scope / Permissions |
| --- | --- | --- | --- |
| `company_admin` | `admin@example.com` | `admin123` | Full company access, user CRUD, shift config, audit |
| `regional_manager` | `regional@example.com` | `regional123` | Regional monitoring, user creation, abnormality resolution |
| `factory_supervisor` | `supervisor@example.com` | `supervisor123` | Factory tasks, submission review, abnormality resolution |
| `operator` (Incoming) | `operator@example.com` | `operator123` | Production entry, 5S logs, abnormality report, **acknowledge handover** |
| `operator` (Outgoing) | `john@example.com` | `employee123` | Outgoing shift production, 5S, abnormality report, generate handover |
| `maintenance_engineer` | `maintenance@example.com` | `maint123` | Maintenance records, inspection notes, abnormality resolution |

---

## 5. Simulation, Fault/Recovery & Handover PDF Guide

### Starting & Controlling the Simulation
1. Open **`http://127.0.0.1:5173/digital-twin/simulation`** (or click **Simulation** in the top navigation bar).
2. Choose an update interval (`1s`, `2s`, or `5s`) and click **Start Simulation**.
3. Use **Pause**, **Resume**, **Stop**, **Step 1 Tick**, or **Reset** at any time; the top bar (`SIM • RUNNING (#ticks)`) and the 23-machine live telemetry table update automatically via WebSocket (`/ws/digital-twin`).

### Triggering a Fault & Recovering a Machine
1. Select any machine from the **Selected Machine Fault & Recovery Control** dropdown (or click a machine in the 3D factory/line view to open `/digital-twin/machine/:machineId`).
2. Click **Trigger Fault (E-402)** — the machine switches to `Fault`, its 3D Andon stack light pulses red, a `MachineEvent` is logged, and the WebSocket pushes the state to all open views.
3. Log an abnormality under **Abnormalities** (or resolve it as Maintenance Engineer / Supervisor), then click **Recover to Running** (or **Clear & Recover**) to return the machine to `Running` and log a `fault_cleared` event.

### Generating, Previewing & Downloading a Handover PDF
1. Sign in via **Operator Sign-In** (e.g. Outgoing Operator `john@example.com` / `employee123`).
2. Open any machine (`/digital-twin/machine/:machineId`) → **Shift Handover** tab → click **Generate Handover**.
3. Click **Preview PDF** (`/api/download/<report_id>?inline=true`) to inspect inline in the browser or **Download PDF** (`/api/download/<report_id>`) to save the A4 report.
4. Sign in as Incoming Operator (`operator@example.com` / `operator123`) and click **Acknowledge Handover**; the PDF automatically re-renders with the operator's acknowledgement timestamp and remarks.

### Troubleshooting
- **WebSocket shows `Disconnected`:** Confirm the backend is running on `127.0.0.1:8000` (`curl http://127.0.0.1:8000/api/health`) and refresh the page; the client reconnects automatically with exponential backoff.
- **SQLite database lock or stale seed:** Stop `uvicorn`, delete `backend/digital_twin.db*`, and restart `uvicorn` to recreate and seed cleanly with WAL concurrency enabled.
- **401 / 403 on operational actions:** Sign in via **Operator Sign-In** with an authorized role (e.g., `operator` for production/5S/handover acknowledgement, `maintenance_engineer` for maintenance/abnormality resolution).

---

## 6. Full Demo Workflow

1. Open `http://127.0.0.1:5173/digital-twin` (Company Digital Twin).
2. Drill down: **South India Region** → **Factory A — Chennai Precision Machining** → **Explore Line** on **Production Line 01**.
3. Scroll vertically along the production corridor from Station 01 to Station 03 (`MCH-103`) and click **Inspect Machine Specifications & Telemetry**.
4. Sign in as **Outgoing Operator (`john@example.com`)** and click **Trigger Fault** on **Overview & Specs**.
5. Open **Abnormalities**, create a Critical abnormality, then open **Production, 5S & Maint.** to log production units and click **Verify & Log 5S**.
6. Switch to **Maintenance Engineer (`maintenance@example.com`)** and log a Corrective maintenance record.
7. Switch back to **Outgoing Operator (`john@example.com`)**, open **Shift Handover**, and click **Generate Handover**; click **Download PDF** to inspect the ReportLab shift report.
8. Sign in as **Incoming Operator (`operator@example.com`)** and click **Acknowledge Handover** on pending handovers for `MCH-103`.
9. Open **Events & Audit** (`/digital-twin/events`) to verify the complete audit trail, and click **Company** breadcrumb to confirm updated pending handover counts.

---

## 7. API Documentation Location

When the backend is running (`port 8000`):
- **Swagger UI:** `http://127.0.0.1:8000/docs`
- **ReDoc:** `http://127.0.0.1:8000/redoc`
- **OpenAPI JSON:** `http://127.0.0.1:8000/openapi.json`

---

## 8. Flutter Mobile Setup (`mobile_flutter/`)

```bash
cd mobile_flutter
flutter pub get
flutter analyze
flutter test
flutter run -d chrome   # or Android/iOS pointed at http://<HOST_IP>:8000
```

> **Note:** `flutter` / `dart` SDK was not installed on the validation machine, so `mobile_flutter/` compilation and static analysis remain unverified locally.

---

## 9. Known Limitations

- **Simulation Telemetry:** Telemetry values (`temperature_c`, `vibration_mm_s`, `energy_kw`, `production_count`) are generated by the software simulation engine (`data_source="simulation"`) and operator entries (`"operator_entry"`), not physical PLC/OPC-UA hardware.
- **Flutter SDK Unverified:** `mobile_flutter/` code was adapted for PS-032 REST/JWT/offline-queue endpoints, but `flutter pub get` / `flutter analyze` / `flutter test` have not been executed in this environment.
- **Interactive Browser Click-Through:** Headless/desktop Chrome DevTools remote debugging was unavailable on the validation host (`DevToolsActivePort` missing), so live end-to-end flows were verified via automated tests (`pytest`) and live Vite proxy + WebSocket + PDF binary verification (`httpx` / `websockets`), alongside `tsc -b && vite build`.
- **Single-Host SQLite Default:** Default persistence uses local SQLite (`backend/digital_twin.db`); set `DT_DATABASE_URL` for PostgreSQL in multi-node deployments.
