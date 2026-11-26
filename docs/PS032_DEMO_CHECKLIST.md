# PS-032 Judge Presentation & Demo Checklist

Use this concise sequence when presenting the **PS-032 Industrial Digital Twin & Smart Shift Handover** platform.

## Pre-Demo Verification (Before Judges Arrive)
- [ ] Backend running at `http://127.0.0.1:8000` (`cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000`)
- [ ] Frontend running at `http://127.0.0.1:5173/digital-twin` (`cd frontend && npm run dev -- --host 127.0.0.1 --port 5173`)
- [ ] Confirm **Live Sync** green indicator in top bar and **4 Factories / 23 Machines** in Company KPIs
- [ ] Optional: Start simulator ticks in `/digital-twin/simulation` (**Start Simulation**)

## Live 5-Minute Walkthrough
1. **Company Twin (`/digital-twin`)**
   - Show the 3 regions across different timezones (`Asia/Kolkata`, `Europe/Berlin`, `America/Chicago`) and live OEE/fault/handover KPIs.
   - Mention **Overview Mode** toggle for low-bandwidth or non-WebGL stations.
2. **Region & Shift Schedules (`/digital-twin/region/reg-south-india`)**
   - Show independent timezone-aware shift windows (including midnight-crossing Night Shift `22:00–06:00`) and inline edit capability.
3. **Factory Floor (`/digital-twin/factory/fac-chn-a`)**
   - Show data-driven production lines (`CHN-L01`, `CHN-L02`) and maintenance bay matching backend DB configuration.
4. **Scroll-Driven Production Line Journey (`/digital-twin/line/line-chn-01`)**
   - Scroll vertically with trackpad/mouse wheel from Station 01 to Station 03 (`MCH-103`) — highlight smooth machine-centered framing and live HUD.
5. **Machine Fault, Abnormality & Operational Logs (`/digital-twin/machine/mch-chn-103`)**
   - Sign in as **Outgoing Operator (`john@example.com`)**.
   - Click **Trigger Fault** → 3D Andon stack light pulses red and status updates via WebSocket.
   - Open **Abnormalities** tab → log a Critical abnormality.
   - Open **Production, 5S & Maint.** tab → log production (OEE recalculates live) and click **Verify & Log 5S**.
   - Switch to **Maintenance Engineer (`maintenance@example.com`)** → log Corrective maintenance (and note RBAC blocks maintenance from entering production).
6. **Grounded Shift Handover & ReportLab PDF**
   - Switch back to **Outgoing Operator (`john@example.com`)** → open **Shift Handover** → click **Generate Handover**.
   - Click **Download PDF** to display the single-file grounded ReportLab shift report.
7. **Incoming Operator Acknowledgement & Audit Trail**
   - Switch to **Incoming Operator (`operator@example.com`)** → confirm machine condition checkbox & click **Acknowledge Handover**.
   - Open **Events & Audit** (`/digital-twin/events`) to show immutable audit trail entries (`abnormality_created`, `handover_generated`, `handover_acknowledged`).
   - Click **Company** breadcrumb to confirm the company-wide **Pending Handovers** counter decremented live.

