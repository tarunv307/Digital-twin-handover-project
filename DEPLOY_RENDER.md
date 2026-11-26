# PS-032 Industrial Digital Twin — Render Production Deployment Guide

This workspace is configured to deploy seamlessly on **Render** with **FastAPI**, **React + Vite**, **WebSockets (`wss://`)**, **ReportLab PDF/ZIP generation**, and **Render PostgreSQL**.

---

## Recommended Architecture (Single Render Web Service + Render PostgreSQL)

Because FastAPI serves the built React SPA (`frontend/dist`) directly after all `/api/*` and `/ws/*` routes (`DT_SERVE_FRONTEND=true`), deploying as **1 Render Web Service + 1 Render PostgreSQL Database** keeps Frontend, API, WebSockets, and Secure HttpOnly Auth Cookies on a single HTTPS origin cleanly—eliminating cross-domain cookie/CORS friction.

---

## Option A — One-Click Render Blueprint (`render.yaml`)

1. Initialize Git in `/Users/tarun.v/sakthi` and push to GitHub/GitLab (never commit `.env` or `digital_twin.db*`—`.gitignore` already excludes them):
   ```bash
   cd /Users/tarun.v/sakthi
   git init
   git add .
   git commit -m "Prepare PS-032 Industrial Digital Twin for Render deployment"
   git remote add origin https://github.com/<your-org>/<your-repo>.git
   git push -u origin main
   ```
2. In the **Render Dashboard**, click **New + → Blueprint**, connect your repository, and select `render.yaml`.
3. Render automatically provisions:
   - **PostgreSQL**: `ps032-db` (`ps032_digital_twin`)
   - **Web Service**: `ps032-digital-twin`
     - **Build Command**: `cd frontend && npm ci && npm run build && cd ../backend && pip install -r requirements.txt`
     - **Start Command**: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
     - **Health Check Path**: `/api/health`

---

## Option B — Manual Render Dashboard Setup (Unified Service or Split Static Site)

### 1. Render PostgreSQL Database
- Create a PostgreSQL instance (`ps032-db`).
- Copy its **Internal Database URL** (for Render Web Services in the same region) or **External Database URL** (for running the SQLite migration script from your local machine).

### 2. Render Web Service (FastAPI + Built React Frontend)
- **Root Directory**: *(leave empty — project root)*
- **Runtime**: `Python 3` (`PYTHON_VERSION=3.12.7`)
- **Build Command**:
  ```bash
  cd frontend && npm ci && npm run build && cd ../backend && pip install -r requirements.txt
  ```
- **Start Command**:
  ```bash
  cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
  ```
- **Health Check Path**: `/api/health`
- **Required Environment Variables**:
  | Variable | Value |
  | --- | --- |
  | `DATABASE_URL` | Render PostgreSQL Internal Connection String (`postgres://...` or `postgresql://...` — automatically normalized to `postgresql+psycopg://`) |
  | `DT_SECRET_KEY` | Strong random secret (use Render "Generate") |
  | `DT_SERVE_FRONTEND` | `true` |
  | `DT_SIMULATION_AUTOSTART` | `false` *(or `true` if continuous background simulation is desired)* |
  | `DT_CORS_ORIGINS` | Your Render URL, e.g. `https://ps032-digital-twin.onrender.com` (`RENDER_EXTERNAL_URL` is also auto-included) |
  | `DT_COOKIE_SAMESITE` | `lax` |
  | `NODE_VERSION` | `20.18.0` |

### Optional: Separate Render Static Site (Split Frontend + Backend)
If you prefer hosting `frontend/` on a **Render Static Site** separately:
1. On the Static Site:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm ci && npm run build`
   - **Publish Directory**: `dist`
   - **Rewrite / Redirect Rule** (`_redirects` is already included at `frontend/public/_redirects`): Source `/*` → Destination `/index.html` (Action: `Rewrite`)
   - **Frontend Env Vars**:
     - `VITE_API_BASE_URL=https://<backend-service>.onrender.com`
     - `VITE_WS_URL=wss://<backend-service>.onrender.com/ws/digital-twin`
2. On the Backend Web Service:
   - Set `DT_SERVE_FRONTEND=false`
   - Set `DT_CORS_ORIGINS=https://<static-site>.onrender.com`
   - Set `DT_COOKIE_SAMESITE=none` and `DT_COOKIE_SECURE=true`

---

## Migrating Existing Local SQLite Data to Render PostgreSQL

On first boot against an empty PostgreSQL database, `app.main` automatically creates all tables and seeds the initial Apex Precision Manufacturing hierarchy, 23 machines, and 5 RBAC roles without duplicating records on subsequent restarts.

To migrate existing records from your local `backend/digital_twin.db` to Render PostgreSQL without touching your local SQLite file:

```bash
export TARGET_DATABASE_URL="<Render External PostgreSQL URL>"
cd /Users/tarun.v/sakthi
backend/.venv/bin/python backend/scripts/migrate_sqlite_to_postgres.py --target "$TARGET_DATABASE_URL"
```

---

## Post-Deployment Verification Checklist on Live Render URL

Once Render reports **Live**, verify every workflow against `https://<your-render-url>`:
1. `GET /api/health` returns `{"status": "ok", "database": "ok"}`.
2. Landing page `/` loads with Hero, India OpenStreetMap, 3 Region cards, Company Hierarchy Tree, and platform overview.
3. Clicking a factory opens `/digital-twin/factory/:id` (3D Exterior → **Enter Factory** → Interior Hall → Machine selection).
4. Login (`admin@example.com`, `regional@example.com`, `supervisor@example.com`, `john@example.com`, `maintenance@example.com`) persists session tokens and enforces RBAC.
5. **Company Admin** sees all 3 regions & company-wide Centralized Reports; **Regional Manager** sees only South Region Reports; **Supervisor/Operator/Maintenance** receive `Access Denied` on `/digital-twin/reports` and `403` on `/api/ps032/reports*`.
6. Individual PDF and factory/region bulk PDF/ZIP downloads succeed.
7. WebSocket connects (`wss://<your-render-url>/ws/digital-twin`) and shows `Live Sync`.
8. Restart the Render Web Service and confirm created records remain persisted in PostgreSQL.
