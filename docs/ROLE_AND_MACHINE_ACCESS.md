# PS-032 Role-Based & Machine-Based Access Control

PS-032 enforces **backend-authoritative Role-Based Access Control (RBAC)** combined with **normalized Operator-to-Machine & Shift assignments** (`operator_assignments` table). Frontend route guards and navigation visibility mirror these rules, while all API endpoints independently verify authorization (`401` / `403`).

## Supported Roles

| Role | Organizational Scope | Machine & Shift Access | Key Capabilities |
| :--- | :--- | :--- | :--- |
| `company_admin` | Company-wide | Unrestricted | Full hierarchy, user CRUD, role assignment, delete users, machine/shift assignments, analytics, audit logs |
| `regional_manager` | `assigned_region_id` | All factories/machines in assigned region | Create/update factory personnel in region, assign machines, review checklists, regional analytics |
| `factory_supervisor` | `assigned_factory_id` | All lines/machines in assigned factory | Create/update operators & maintenance engineers in factory, assign machines/shifts, approve safety checklists, oversee handovers |
| `operator` | Assigned machine/shift bindings only | Strictly active `OperatorAssignment` rows | Auto-routed to `/digital-twin/operator`; inspect assigned machines/QR passports; log production, downtime, 5S, quality, safety checklist, abnormalities; generate & incoming-ack handovers |
| `maintenance_engineer` | Assigned machine/factory scope | Assigned machines/factory | Log & complete maintenance records, schedule/complete PM work orders, investigate/resolve abnormalities (blocked from production entry & user admin) |

## Normalized Assignment Model (`OperatorAssignment`)
- Stored in `operator_assignments` (`user_id`, `machine_id`, `line_id`, `factory_id`, `shift_id`, `shift_name`, `assigned_by_id`, `start_date`, `end_date`, `is_active`, `notes`).
- Supervisory endpoints:
  - `GET /api/ps032/assignments`
  - `POST /api/ps032/assignments`
  - `PATCH /api/ps032/assignments/{assignment_id}`
  - `DELETE /api/ps032/assignments/{assignment_id}` (deactivates and audits removal)

## Strict Enforcement Rules
1. **Unassigned Machine Protection**: An operator receives `403 Forbidden` if attempting to open `/api/dt/machines/{id}`, `/api/ps032/machines/{id}/workspace`, `/api/ps032/passport/{qr}`, or submit operational writes on any machine not actively assigned to them.
2. **Immediate Revocation**: Deactivating an assignment (`DELETE /api/ps032/assignments/{id}`) or deactivating a user account (`PUT /api/users/{id}` with `is_active: false`) immediately blocks login and machine access on subsequent API requests.
3. **Shift Handover Security**:
   - Outgoing operator cannot acknowledge their own generated handover (`403`).
   - Incoming operator cannot acknowledge a handover for an unassigned machine or a non-matching shift unless explicitly designated (`403`).
4. **Operator Self-Service Views**:
   - `/digital-twin/operator` (`GET /api/ps032/my-machines`) lists only assigned machines.
   - `/digital-twin/my-reports` (`GET /api/ps032/my-reports`) lists submitted production, abnormality, safety, quality, downtime, and handover records.
5. **Admin Governance UI**:
   - `/digital-twin/users` supports user search/filter, creation, password reset, activation/deactivation, machine & shift assignment management, and full per-user history.
