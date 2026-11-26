import type {
  Abnormality,
  AuditEvent,
  CentralizedReportPreview,
  CentralizedReportsResponse,
  Cleaning5SLog,
  CompanyHierarchy,
  CompanyOverview,
  DowntimeEvent,
  FactoryAnalyticsResponse,
  FactoryDetail,
  HandoverRecord,
  MachineDetail,
  MachineEnergy,
  MachineEvent,
  MachineHealth,
  MachineStatus,
  MachineWorkspace,
  MaintenanceRecord,
  MaintenanceSchedule,
  MyMachineItem,
  MyReportsResponse,
  OperatorAssignment,
  PersonnelDetail,
  PersonnelSummary,
  ProductionEntry,
  ProductionLineDetail,
  QrPassportData,
  QualityInspection,
  RegionDetail,
  SafetyChecklist,
  SafetyChecklistItemInput,
  ShiftContext,
  ShiftRosterResponse,
  ShiftTransitionLogItem,
  ShiftWindow,
  SimulationStatus,
  UserAccount,
  UserHistoryResponse,
} from "../types/digitalTwin";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_STORAGE_KEY = "ps032_access_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const json = await res.json();
      detail = json.detail || json.error || detail;
    } catch {
      detail = await res.text().catch(() => res.statusText);
    }
    throw new Error(`${detail} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export const digitalTwinApi = {
  // Phase 1 Digital Twin Hierarchy
  getCompanyOverview: () => request<CompanyOverview>("/api/dt/company"),
  getCompanyHierarchy: () => request<CompanyHierarchy>("/api/dt/hierarchy"),
  getRegionDetail: (regionId: string) => request<RegionDetail>(`/api/dt/regions/${regionId}`),
  getFactoryDetail: (factoryId: string) => request<FactoryDetail>(`/api/dt/factories/${factoryId}`),
  getLineDetail: (lineId: string) => request<ProductionLineDetail>(`/api/dt/lines/${lineId}`),
  getMachineDetail: (machineId: string) => request<MachineDetail>(`/api/dt/machines/${machineId}`),
  getMachineByQr: (qrToken: string) => request<MachineDetail>(`/api/dt/machines/by-qr/${qrToken}`),

  getEvents: (params?: {
    region_id?: string;
    factory_id?: string;
    line_id?: string;
    machine_id?: string;
    severity?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.region_id) q.set("region_id", params.region_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.line_id) q.set("line_id", params.line_id);
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.severity) q.set("severity", params.severity);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<MachineEvent[]>(`/api/dt/events${qs ? `?${qs}` : ""}`);
  },

  getShiftContext: (regionId: string, factoryId?: string) => {
    const q = new URLSearchParams({ region_id: regionId });
    if (factoryId) q.set("factory_id", factoryId);
    return request<ShiftContext>(`/api/dt/shifts/context?${q.toString()}`);
  },

  updateShiftSchedule: (
    scheduleId: string,
    body: Partial<{
      shift_name: string;
      start_time: string;
      end_time: string;
      timezone: string;
      supervisor: string;
      handover_deadline_minutes: number;
    }>
  ) =>
    request<ShiftWindow>(`/api/dt/shifts/${scheduleId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getShiftTransitions: () => request<ShiftTransitionLogItem[]>("/api/dt/shift-transitions"),

  getSimulationStatus: () => request<SimulationStatus>("/api/dt/simulation/status"),
  startSimulation: () => request<SimulationStatus>("/api/dt/simulation/start", { method: "POST" }),
  pauseSimulation: () => request<SimulationStatus>("/api/dt/simulation/pause", { method: "POST" }),
  resumeSimulation: () => request<SimulationStatus>("/api/dt/simulation/resume", { method: "POST" }),
  stopSimulation: () => request<SimulationStatus>("/api/dt/simulation/stop", { method: "POST" }),
  resetSimulation: () => request<SimulationStatus>("/api/dt/simulation/reset", { method: "POST" }),
  setSimulationInterval: (intervalSec: number) =>
    request<SimulationStatus>("/api/dt/simulation/interval", {
      method: "POST",
      body: JSON.stringify({ interval_sec: intervalSec }),
    }),
  tickSimulation: () =>
    request<{ ticks_emitted: number; updated_machines: number; simulation?: SimulationStatus }>(
      "/api/dt/simulation/tick",
      { method: "POST" }
    ),
  triggerFault: (machineId: string, faultCode = "E-402", faultMessage = "Simulated thermal / vibration limit breach") =>
    request("/api/dt/simulation/fault", {
      method: "POST",
      body: JSON.stringify({ machine_id: machineId, fault_code: faultCode, fault_message: faultMessage }),
    }),
  recoverMachine: (machineId: string) =>
    request("/api/dt/simulation/recover", {
      method: "POST",
      body: JSON.stringify({ machine_id: machineId }),
    }),
  setMachineStatus: (machineId: string, targetStatus: MachineStatus) =>
    request("/api/dt/simulation/set-status", {
      method: "POST",
      body: JSON.stringify({ machine_id: machineId, target_status: targetStatus }),
    }),
  simulateShiftTransition: (regionId: string, factoryId?: string) =>
    request("/api/dt/simulation/shift-transition", {
      method: "POST",
      body: JSON.stringify({ region_id: regionId, factory_id: factoryId }),
    }),

  // Phase 2 Auth & RBAC
  login: async (email: string, password: string) => {
    const res = await request<{ message: string; access_token: string; user: UserAccount }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.access_token);
    return res.user;
  },
  logout: async () => {
    await request("/api/logout", { method: "POST" }).catch(() => {});
    setStoredToken(null);
  },
  getMe: () => request<{ authenticated: boolean; user: UserAccount | null }>("/api/me"),
  listUsers: (params?: string | { q?: string; role?: string; is_active?: boolean }) => {
    if (typeof params === "string") {
      return request<UserAccount[]>(`/api/users${params ? `?q=${encodeURIComponent(params)}` : ""}`);
    }
    const q = new URLSearchParams();
    if (params?.q) q.set("q", params.q);
    if (params?.role) q.set("role", params.role);
    if (params?.is_active !== undefined) q.set("is_active", String(params.is_active));
    const qs = q.toString();
    return request<UserAccount[]>(`/api/users${qs ? `?${qs}` : ""}`);
  },
  createUser: (body: {
    name: string;
    email: string;
    password: string;
    role: string;
    employee_id?: string;
    assigned_region_id?: string;
    assigned_factory_id?: string;
  }) =>
    request<UserAccount>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUser: (
    userId: number,
    body: Partial<{
      name: string;
      role: string;
      employee_id: string;
      assigned_region_id: string | null;
      assigned_factory_id: string | null;
      is_active: boolean;
      password: string;
    }>
  ) =>
    request<UserAccount>(`/api/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteUser: (userId: number) =>
    request<{ message: string }>(`/api/users/${userId}`, { method: "DELETE" }),
  getUserHistory: (userId: number) =>
    request<UserHistoryResponse>(`/api/users/${userId}/history`),

  // Phase 2 Industrial Operations & Shift Handovers
  getMachineWorkspace: (machineId: string) =>
    request<MachineWorkspace>(`/api/ps032/machines/${machineId}/workspace`),

  listProductionEntries: (params?: { machine_id?: string; factory_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<ProductionEntry[]>(`/api/ps032/production${qs ? `?${qs}` : ""}`);
  },

  listAbnormalities: (params?: { machine_id?: string; factory_id?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Abnormality[]>(`/api/ps032/abnormalities${qs ? `?${qs}` : ""}`);
  },

  listMaintenanceRecords: (params?: { machine_id?: string; factory_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<MaintenanceRecord[]>(`/api/ps032/maintenance${qs ? `?${qs}` : ""}`);
  },

  recordProduction: (body: {
    machine_id: string;
    units_produced: number;
    target_units?: number;
    reject_units?: number;
    downtime_minutes?: number;
    remarks?: string;
  }) =>
    request<ProductionEntry>("/api/ps032/production", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createAbnormality: (body: {
    machine_id: string;
    title: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    fault_code?: string;
  }) =>
    request<Abnormality>("/api/ps032/abnormalities", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateAbnormality: (
    abnId: number,
    body: { status?: "open" | "investigating" | "resolved"; resolution_notes?: string }
  ) =>
    request<Abnormality>(`/api/ps032/abnormalities/${abnId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createMaintenance: (body: {
    machine_id: string;
    maintenance_type: "preventive" | "corrective" | "calibration";
    status: "scheduled" | "in_progress" | "completed";
    summary: string;
    inspection_notes?: string;
    parts_replaced?: string;
  }) =>
    request<MaintenanceRecord>("/api/ps032/maintenance", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateMaintenance: (recId: number, body: { status?: "scheduled" | "in_progress" | "completed"; inspection_notes?: string }) =>
    request<MaintenanceRecord>(`/api/ps032/maintenance/${recId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createCleaning5S: (body: {
    machine_id: string;
    area_cleaned: boolean;
    lubrication_checked: boolean;
    guards_verified: boolean;
    safety_observations?: string;
  }) =>
    request<Cleaning5SLog>("/api/ps032/cleaning", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listHandovers: (params?: { machine_id?: string; factory_id?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<HandoverRecord[]>(`/api/ps032/handovers${qs ? `?${qs}` : ""}`);
  },

  generateHandover: (body: {
    machine_id: string;
    operator_remarks?: string;
    maintenance_instructions?: string;
    required_inspection?: string;
    special_instructions?: string;
    incoming_operator?: string;
  }) =>
    request<HandoverRecord>("/api/ps032/handovers/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  acknowledgeHandover: (handoverId: string, body: { remarks?: string; condition_confirmed: boolean }) =>
    request<HandoverRecord>(`/api/ps032/handovers/${handoverId}/acknowledge`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getAuditTrail: (params?: { machine_id?: string; factory_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<AuditEvent[]>(`/api/ps032/audit${qs ? `?${qs}` : ""}`);
  },

  // Phase 4 Assignments, Expansion & Analytics
  listAssignments: (params?: { user_id?: number; machine_id?: string; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.user_id !== undefined) q.set("user_id", String(params.user_id));
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.active_only) q.set("active_only", "true");
    const qs = q.toString();
    return request<OperatorAssignment[]>(`/api/ps032/assignments${qs ? `?${qs}` : ""}`);
  },
  createAssignment: (body: {
    user_id: number;
    machine_id?: string;
    line_id?: string;
    factory_id?: string;
    shift_id?: string;
    shift_name?: string;
    start_date?: string;
    end_date?: string;
    is_active?: boolean;
    notes?: string;
  }) =>
    request<OperatorAssignment>("/api/ps032/assignments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAssignment: (
    assignmentId: number,
    body: Partial<{
      machine_id: string;
      shift_name: string;
      start_date: string;
      end_date: string;
      is_active: boolean;
      notes: string;
    }>
  ) =>
    request<OperatorAssignment>(`/api/ps032/assignments/${assignmentId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAssignment: (assignmentId: number) =>
    request<{ message: string }>(`/api/ps032/assignments/${assignmentId}`, { method: "DELETE" }),

  getMyMachines: () => request<{ user: { id: number; name: string; role: string }; machines: MyMachineItem[] }>("/api/ps032/my-machines"),
  getMyReports: () => request<MyReportsResponse>("/api/ps032/my-reports"),

  listDowntime: (params?: { machine_id?: string; factory_id?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<DowntimeEvent[]>(`/api/ps032/downtime${qs ? `?${qs}` : ""}`);
  },
  createDowntime: (body: {
    machine_id: string;
    category: "planned" | "unplanned";
    reason_category: string;
    reason_detail: string;
    duration_minutes?: number;
  }) =>
    request<DowntimeEvent>("/api/ps032/downtime", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDowntime: (
    dtId: number,
    body: { status?: "open" | "closed"; duration_minutes?: number; reason_category?: string; reason_detail?: string }
  ) =>
    request<DowntimeEvent>(`/api/ps032/downtime/${dtId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listSafetyChecklists: (machineId?: string) =>
    request<SafetyChecklist[]>(`/api/ps032/safety-checklists${machineId ? `?machine_id=${encodeURIComponent(machineId)}` : ""}`),
  submitSafetyChecklist: (body: {
    machine_id: string;
    items: SafetyChecklistItemInput[];
    operator_remarks?: string;
  }) =>
    request<SafetyChecklist>("/api/ps032/safety-checklists", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reviewSafetyChecklist: (chkId: number, body: { supervisor_review_status: "reviewed" | "rejected"; supervisor_notes?: string }) =>
    request<SafetyChecklist>(`/api/ps032/safety-checklists/${chkId}/review`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listMaintenanceSchedules: (params?: { machine_id?: string; factory_id?: string; overdue_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.overdue_only) q.set("overdue_only", "true");
    const qs = q.toString();
    return request<MaintenanceSchedule[]>(`/api/ps032/maintenance-schedules${qs ? `?${qs}` : ""}`);
  },

  listPersonnel: (params?: {
    q?: string;
    region_id?: string;
    factory_id?: string;
    machine_id?: string;
    role?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.q) q.set("q", params.q);
    if (params?.region_id) q.set("region_id", params.region_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.role) q.set("role", params.role);
    const qs = q.toString();
    return request<PersonnelSummary[]>(`/api/ps032/personnel${qs ? `?${qs}` : ""}`);
  },

  getPersonnelProfile: (userId: number) =>
    request<PersonnelDetail>(`/api/ps032/personnel/${userId}`),
  createMaintenanceSchedule: (body: {
    machine_id: string;
    title: string;
    maintenance_type: "preventive" | "corrective" | "calibration";
    frequency_days: number;
    due_date: string;
    assigned_engineer_id?: number;
  }) =>
    request<MaintenanceSchedule>("/api/ps032/maintenance-schedules", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMaintenanceSchedule: (
    schedId: number,
    body: {
      status?: "scheduled" | "in_progress" | "completed";
      due_date?: string;
      inspection_notes?: string;
      parts_replaced?: string;
    }
  ) =>
    request<MaintenanceSchedule>(`/api/ps032/maintenance-schedules/${schedId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listQualityInspections: (machineId?: string) =>
    request<QualityInspection[]>(`/api/ps032/quality${machineId ? `?machine_id=${encodeURIComponent(machineId)}` : ""}`),
  createQualityInspection: (body: {
    machine_id: string;
    inspected_qty: number;
    rejected_qty: number;
    reworked_qty: number;
    defect_category: string;
    remarks?: string;
  }) =>
    request<QualityInspection>("/api/ps032/quality", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMachineHealth: (machineId: string) => request<MachineHealth>(`/api/ps032/machines/${machineId}/health`),
  getMachineEnergy: (machineId: string) => request<MachineEnergy>(`/api/ps032/machines/${machineId}/energy`),
  getQrPassport: (qrOrMachineId: string) => request<QrPassportData>(`/api/ps032/passport/${encodeURIComponent(qrOrMachineId)}`),
  getShiftRoster: (params?: { region_id?: string; factory_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.region_id) q.set("region_id", params.region_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    const qs = q.toString();
    return request<ShiftRosterResponse>(`/api/ps032/shift-roster${qs ? `?${qs}` : ""}`);
  },
  getFactoryAnalytics: (params?: {
    region_id?: string;
    factory_id?: string;
    line_id?: string;
    machine_id?: string;
    shift_name?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.region_id) q.set("region_id", params.region_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.line_id) q.set("line_id", params.line_id);
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.shift_name) q.set("shift_name", params.shift_name);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    const qs = q.toString();
    return request<FactoryAnalyticsResponse>(`/api/ps032/analytics${qs ? `?${qs}` : ""}`);
  },

  // Centralized Industrial Reports & One-Click Downloads
  listCentralizedReports: (params?: {
    region_id?: string;
    factory_id?: string;
    line_id?: string;
    machine_id?: string;
    category?: string;
    status?: string;
    shift_name?: string;
    start_date?: string;
    end_date?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.region_id) q.set("region_id", params.region_id);
    if (params?.factory_id) q.set("factory_id", params.factory_id);
    if (params?.line_id) q.set("line_id", params.line_id);
    if (params?.machine_id) q.set("machine_id", params.machine_id);
    if (params?.category) q.set("category", params.category);
    if (params?.status) q.set("status", params.status);
    if (params?.shift_name) q.set("shift_name", params.shift_name);
    if (params?.start_date) q.set("start_date", params.start_date);
    if (params?.end_date) q.set("end_date", params.end_date);
    const qs = q.toString();
    return request<CentralizedReportsResponse>(`/api/ps032/reports${qs ? `?${qs}` : ""}`);
  },

  previewCentralizedReport: (reportUid: string) =>
    request<CentralizedReportPreview>(`/api/ps032/reports/preview/${encodeURIComponent(reportUid)}`),

  downloadFile: async (path: string, fallbackFilename: string) => {
    const token = getStoredToken();
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.detail || detail;
      } catch {
        detail = await res.text().catch(() => res.statusText);
      }
      throw new Error(`${detail} (HTTP ${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const match = cd.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || fallbackFilename;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
