# PS-032 Industrial Operations Feature Expansion

This document describes the 10 industrial operations modules built on top of the PS-032 Digital Twin & Shift Handover architecture.

## 1. Production Target vs Actual
- Tracks per-machine target output, actual quantity, rejected quantity, good quantity (`actual - rejects`), and achievement percentage.
- Shift-wise and line-wise comparisons are computed directly from persisted `ProductionEntry` and `MachineState` tables in `backend/app/services/analytics_service.py`.

## 2. Downtime & Loss Analysis
- Model: `DowntimeEvent` (`planned` / `unplanned`, `reason_category`, `reason_detail`, `started_at`, `ended_at`, `duration_minutes`, `status`).
- Endpoints: `GET /api/ps032/downtime`, `POST /api/ps032/downtime`, `PATCH /api/ps032/downtime/{dt_id}`.
- Updates live telemetry availability, downtime totals, top causes ranking, and OEE impact.

## 3. Digital Safety Checklist
- Model: `SafetyChecklist` (`items_json`, `overall_status`, `has_critical_failure`, `escalated_abnormality_id`, `supervisor_review_status`).
- Endpoints: `GET /api/ps032/safety-checklists`, `POST /api/ps032/safety-checklists`, `PATCH /api/ps032/safety-checklists/{chk_id}/review`.
- Critical item failures automatically raise a critical `Abnormality` (`SAFETY-CRIT`) and switch the Digital Twin machine state to `Fault`. Note: this software workflow notifies personnel and updates Twin state—it does not replace hardware safety interlocks.

## 4. Preventive Maintenance Planner
- Model: `MaintenanceSchedule` (`title`, `maintenance_type`, `frequency_days`, `due_date`, `next_service_date`, `status`, `linked_record_id`).
- Endpoints: `GET /api/ps032/maintenance-schedules`, `POST /api/ps032/maintenance-schedules`, `PATCH /api/ps032/maintenance-schedules/{sched_id}`.
- Overdue schedules are flagged (`is_overdue`); starting or completing a schedule creates/completes a linked `MaintenanceRecord`.

## 5. Quality & Defect Management
- Model: `QualityInspection` (`inspected_qty`, `rejected_qty`, `reworked_qty`, `defect_category`, `remarks`, `production_entry_id`).
- Endpoints: `GET /api/ps032/quality`, `POST /api/ps032/quality`.
- Updates machine `quality_pct` and feeds defect-by-category breakdowns in factory analytics.

## 6. Smart Shift Planning & Handover Roster
- Endpoint: `GET /api/ps032/shift-roster`.
- Combines active `OperatorAssignment` shift-machine bindings, pending shift handovers, and regional timezone shift windows.

## 7. Machine Health Score (Software Estimate)
- Endpoint: `GET /api/ps032/machines/{machine_id}/health`.
- Produces a transparent `0–100` score and category (`Healthy`, `Watch`, `Degraded`, `Critical`) with explicit penalty factors and suggested actions from temperature/vibration thresholds, open faults/abnormalities, cumulative downtime, and overdue PM. Clearly labelled as a software-generated estimate.

## 8. Energy Monitoring
- Endpoint: `GET /api/ps032/machines/{machine_id}/energy`.
- Reports active `kW`, estimated shift `kWh`, `kWh/unit`, and estimated idle/downtime `kWh` loss, explicitly marking `is_simulated` vs sensor data source.

## 9. QR Machine Passport
- Backend: `GET /api/ps032/passport/{qr_or_machine_id}` | Frontend: `/digital-twin/qr/:qrToken`.
- Printable digital passport with deterministic SVG QR code, technical specifications, health score, energy draw, safety status, active abnormalities, maintenance history, and current handover status—enforcing strict operator machine access.

## 10. Factory Performance Analytics
- Backend: `GET /api/ps032/analytics` | Frontend: `/digital-twin/analytics`.
- Scoped KPI aggregation (Overall OEE, A/P/Q, Production vs Target, Downtime split, Health distribution, Pending Handovers, Overdue PM) with filters for Region, Factory, Line, Machine, Shift, and Date Range.
