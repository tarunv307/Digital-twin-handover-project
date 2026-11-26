export type MachineStatus =
  | "Running"
  | "Idle"
  | "Stopped"
  | "Fault"
  | "Maintenance"
  | "Offline"
  | "Unknown";

export interface OperationalSummary {
  total_regions: number;
  total_factories: number;
  total_lines: number;
  total_machines: number;
  running_machines: number;
  idle_machines: number;
  stopped_machines: number;
  faulted_machines: number;
  maintenance_machines: number;
  offline_machines: number;
  total_production: number;
  total_target: number;
  overall_oee: number;
  pending_handovers: number;
  active_abnormalities: number;
  open_maintenance_orders?: number;
  overdue_maintenance_orders?: number;
}

export interface ShiftWindow {
  schedule_id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
  timezone: string;
  crosses_midnight: boolean;
  duration_hours: number;
  supervisor: string | null;
  assigned_operators: string[];
  handover_deadline_minutes: number;
}

export interface ShiftContext {
  timezone: string;
  local_time_iso: string;
  current_shift: ShiftWindow | null;
  previous_shift: ShiftWindow | null;
  upcoming_shift: ShiftWindow | null;
  minutes_to_transition: number | null;
  handover_pending_count: number;
  schedules: ShiftWindow[];
}

export interface MachineSpecification {
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  category: string | null;
  installation_date: string | null;
  rated_capacity_units_hr: number | null;
  operating_parameters: Record<string, unknown> | null;
  supported_modes: string[] | null;
  connected_sensors: Array<{ id: string; type: string; unit: string }> | null;
  communication_protocol: string | null;
  operating_limits: Record<string, unknown> | null;
  maintenance_interval_hours: number | null;
  last_maintenance_date: string | null;
  responsible_department: string | null;
}

export interface MachineState {
  status: MachineStatus;
  data_source: string;
  sensor_connectivity: string;
  assigned_operator: string | null;
  production_count: number;
  production_target: number;
  temperature_c: number | null;
  vibration_mm_s: number | null;
  cycle_time_sec: number | null;
  energy_kw: number | null;
  downtime_min: number;
  availability_pct: number;
  performance_pct: number;
  quality_pct: number;
  oee_pct: number;
  active_fault_code: string | null;
  active_fault_message: string | null;
  handover_status: string;
  last_sync_at: string;
  is_stale: boolean;
}

export interface SensorReading {
  id: number;
  machine_id: string;
  timestamp: string;
  status: MachineStatus;
  temperature_c: number | null;
  vibration_mm_s: number | null;
  cycle_time_sec: number | null;
  energy_kw: number | null;
  production_count: number;
  data_source: string;
}

export interface MachineEvent {
  id: number;
  machine_id: string;
  factory_id: string;
  region_id: string;
  line_id: string;
  shift_name: string | null;
  event_type: string;
  severity: "info" | "warning" | "critical" | string;
  previous_status: string | null;
  new_status: string | null;
  message: string;
  data_source: string;
  metadata_json: Record<string, unknown> | null;
  timestamp: string;
}

export interface HandoverHook {
  integration_phase: string;
  handover_status: string;
  previous_shift_name: string | null;
  current_shift_name: string | null;
  message: string;
}

export interface MachineSummary {
  id: string;
  line_id: string;
  name: string;
  code: string;
  machine_type: string;
  sequence_order: number;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  rotation_y: number;
  qr_token: string;
  state: MachineState | null;
}

export interface MachineDetail extends MachineSummary {
  factory_id: string;
  factory_name: string;
  region_id: string;
  region_name: string;
  line_name: string;
  specification: MachineSpecification | null;
  recent_readings: SensorReading[];
  recent_events: MachineEvent[];
  shift_context: ShiftContext | null;
  handover_hook: HandoverHook | null;
}

export interface ProductionLineSummary {
  id: string;
  factory_id: string;
  name: string;
  code: string;
  process_type: string;
  line_index: number;
  floor_offset_z: number;
  target_oee: number;
  summary: OperationalSummary;
  machines: MachineSummary[];
}

export interface ProductionLineDetail extends ProductionLineSummary {
  factory_name: string;
  region_id: string;
  region_name: string;
  shift_context: ShiftContext;
}

export interface FactorySummary {
  id: string;
  region_id: string;
  name: string;
  code: string;
  facility_type: string;
  timezone: string | null;
  floor_width_m: number;
  floor_depth_m: number;
  site_x: number;
  site_z: number;
  latitude?: number;
  longitude?: number;
  location_label?: string;
  active_shift_name: string | null;
  summary: OperationalSummary;
  shift_context: ShiftContext;
}

export interface FactoryDetail extends FactorySummary {
  region_name: string;
  production_lines: ProductionLineSummary[];
}

export interface RegionSummary {
  id: string;
  company_id: string;
  name: string;
  code: string;
  country: string;
  timezone: string;
  map_x: number;
  map_z: number;
  latitude?: number;
  longitude?: number;
  description: string | null;
  summary: OperationalSummary;
  shift_context: ShiftContext;
}

export interface RegionDetail extends RegionSummary {
  company_name: string;
  factories: FactorySummary[];
}

export interface CompanyOverview {
  id: string;
  name: string;
  code: string;
  headquarters: string;
  industry_sector: string;
  description: string | null;
  summary: OperationalSummary;
  regions: RegionDetail[];
}

export interface FactoryTree extends FactorySummary {
  production_lines: ProductionLineSummary[];
}

export interface RegionTree extends RegionSummary {
  company_name: string;
  factories: FactoryTree[];
}

export interface CompanyHierarchy {
  id: string;
  name: string;
  code: string;
  headquarters: string;
  industry_sector: string;
  description: string | null;
  latitude?: number;
  longitude?: number;
  summary: OperationalSummary;
  regions: RegionTree[];
}

export interface SimulationStatus {
  state?: "running" | "paused" | "stopped";
  running: boolean;
  paused?: boolean;
  interval_sec: number;
  mode: string;
  simulated_machines_count?: number;
  ticks_emitted: number;
  last_tick_at: string | null;
}

export interface ShiftTransitionLogItem {
  id: number;
  region_id: string;
  factory_id: string | null;
  previous_shift_name: string;
  new_shift_name: string;
  timezone: string;
  machines_flagged_pending: number;
  notes: string | null;
  transitioned_at: string;
}

export interface TelemetryUpdateItem {
  machine_id: string;
  line_id: string;
  factory_id: string;
  region_id: string;
  state: MachineState;
  event: MachineEvent | null;
}

// Phase 2 PS-032 Types
export interface UserAccount {
  id: number;
  name: string;
  email: string;
  role: string;
  employee_id: string | null;
  assigned_region_id: string | null;
  assigned_factory_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Abnormality {
  id: number;
  code: string;
  machine_id: string;
  factory_id: string;
  region_id: string;
  shift_name: string | null;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  status: "open" | "investigating" | "resolved" | string;
  fault_code: string | null;
  reported_by_id: number | null;
  reported_by_name: string | null;
  assigned_to_id: number | null;
  assigned_to_name: string | null;
  resolution_notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface MaintenanceRecord {
  id: number;
  machine_id: string;
  factory_id: string;
  maintenance_type: string;
  status: string;
  summary: string;
  inspection_notes: string | null;
  parts_replaced: string | null;
  engineer_id: number | null;
  engineer_name: string | null;
  abnormality_id: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface Cleaning5SLog {
  id: number;
  machine_id: string;
  shift_name: string;
  area_cleaned: boolean;
  lubrication_checked: boolean;
  guards_verified: boolean;
  safety_observations: string | null;
  logged_by_id: number | null;
  logged_by_name: string | null;
  logged_at: string;
}

export interface ProductionEntry {
  id: number;
  machine_id: string;
  factory_id: string;
  region_id: string;
  shift_name: string;
  operator_id: number | null;
  operator_name: string | null;
  units_produced: number;
  target_units: number;
  reject_units: number;
  downtime_minutes: number;
  remarks: string | null;
  recorded_at: string;
}

export interface MachineTask {
  id: number;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  machine_id: string | null;
  factory_id: string | null;
  shift_name: string | null;
  assigned_to: number | null;
  created_by: number | null;
  created_at: string;
}

export interface HandoverRecord {
  id: string;
  machine_id: string;
  line_id: string;
  factory_id: string;
  region_id: string;
  previous_shift_name: string;
  incoming_shift_name: string;
  shift_window_label: string;
  timezone: string;
  outgoing_operator: string | null;
  incoming_operator: string | null;
  supervisor_name: string | null;
  production_completed: number;
  production_target: number;
  machine_condition: string;
  downtime_minutes: number;
  pending_abnormalities_count: number;
  maintenance_instructions: string | null;
  cleaning_summary: string | null;
  safety_observations: string | null;
  operator_remarks: string | null;
  required_inspection: string | null;
  special_instructions: string | null;
  grounded_report_json: {
    id: string;
    summary: string;
    total_items: number;
    sections: Record<string, Array<{ section: string; item: string; source: string; record_id: string }>>;
  } | null;
  pdf_filename: string | null;
  status: "pending" | "acknowledged" | string;
  acknowledged_by_user_id: number | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  acknowledgement_remarks: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  machine_id: string | null;
  factory_id: string | null;
  region_id: string | null;
  details: string;
  created_at: string;
}

export interface MachineWorkspace {
  machine_id: string;
  factory_id: string;
  region_id: string;
  abnormalities: Abnormality[];
  maintenance_records: MaintenanceRecord[];
  cleaning_logs: Cleaning5SLog[];
  production_entries: ProductionEntry[];
  handovers: HandoverRecord[];
  tasks: MachineTask[];
  downtime_events?: DowntimeEvent[];
  safety_checklists?: SafetyChecklist[];
  maintenance_schedules?: MaintenanceSchedule[];
  quality_inspections?: QualityInspection[];
  health?: MachineHealth;
  energy?: MachineEnergy;
}

// Phase 4 Industrial Expansion & Access Control Types
export interface OperatorAssignment {
  id: number;
  user_id: number;
  user_name: string | null;
  user_role: string | null;
  employee_id: string | null;
  machine_id: string | null;
  machine_code: string | null;
  machine_name: string | null;
  line_id: string | null;
  factory_id: string | null;
  shift_id: string | null;
  shift_name: string | null;
  assigned_by_id: number | null;
  assigned_by_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface DowntimeEvent {
  id: number;
  machine_id: string;
  line_id: string;
  factory_id: string;
  region_id: string;
  shift_name: string;
  category: "planned" | "unplanned" | string;
  reason_category: string;
  reason_detail: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  status: "open" | "closed" | string;
  reported_by_id: number | null;
  reported_by_name: string | null;
  closed_by_id: number | null;
  closed_by_name: string | null;
  created_at: string;
}

export interface SafetyChecklistItemInput {
  key: string;
  label: string;
  response: "pass" | "fail" | "na";
  critical: boolean;
  remark?: string;
}

export interface SafetyChecklist {
  id: number;
  machine_id: string;
  factory_id: string;
  shift_name: string;
  items_json: SafetyChecklistItemInput[];
  overall_status: "passed" | "critical_fail" | "incomplete" | string;
  has_critical_failure: boolean;
  operator_remarks: string | null;
  escalated_abnormality_id: number | null;
  supervisor_review_status: "pending" | "reviewed" | "rejected" | string;
  supervisor_notes: string | null;
  reviewed_by_id: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  submitted_by_id: number | null;
  submitted_by_name: string | null;
  submitted_at: string;
}

export interface MaintenanceSchedule {
  id: number;
  machine_id: string;
  machine_code: string | null;
  machine_name: string | null;
  factory_id: string;
  title: string;
  maintenance_type: "preventive" | "corrective" | "calibration" | string;
  frequency_days: number;
  due_date: string;
  next_service_date: string | null;
  assigned_engineer_id: number | null;
  assigned_engineer_name: string | null;
  last_completed_at: string | null;
  status: "scheduled" | "in_progress" | "completed" | string;
  is_overdue: boolean;
  linked_record_id: number | null;
  created_at: string;
}

export interface QualityInspection {
  id: number;
  machine_id: string;
  factory_id: string;
  shift_name: string;
  production_entry_id: number | null;
  inspected_qty: number;
  rejected_qty: number;
  reworked_qty: number;
  defect_category: string;
  remarks: string | null;
  inspector_id: number | null;
  inspector_name: string | null;
  inspected_at: string;
}

export interface MachineHealth {
  machine_id: string;
  machine_code?: string;
  score: number;
  category: "Healthy" | "Watch" | "Degraded" | "Critical" | "Unknown" | string;
  is_estimated: boolean;
  disclaimer?: string;
  factors: Array<{ factor: string; impact: number; detail: string }>;
  recommendations?: string[];
  trend: Array<{ timestamp: string; estimated_score: number; temperature_c: number | null; vibration_mm_s: number | null }>;
}

export interface MachineEnergy {
  machine_id: string;
  machine_code?: string;
  current_kw: number;
  avg_kw?: number;
  estimated_shift_kwh?: number;
  kwh_per_unit?: number;
  estimated_downtime_loss_kwh?: number;
  data_source: string;
  is_simulated?: boolean;
  trend: Array<{ timestamp: string; energy_kw: number | null; production_count: number; status: string; data_source: string }>;
}

export interface MyMachineItem {
  id: string;
  code: string;
  name: string;
  machine_type: string;
  qr_token: string;
  line_id: string;
  line_name: string;
  factory_id: string;
  factory_name: string;
  region_id: string;
  region_name: string;
  assigned_shift: string | null;
  state: MachineState | null;
  health_score: number;
  health_category: string;
  has_pending_handover: boolean;
}

export interface MyReportsResponse {
  production_entries: Array<{
    id: number;
    machine_id: string;
    shift_name: string;
    units_produced: number;
    target_units: number;
    reject_units: number;
    good_units: number;
    operator_name: string | null;
    recorded_at: string;
  }>;
  abnormalities: Array<{
    id: number;
    code: string;
    machine_id: string;
    title: string;
    severity: string;
    status: string;
    reported_by_name: string | null;
    created_at: string;
  }>;
  safety_checklists: SafetyChecklist[];
  quality_inspections: QualityInspection[];
  downtime_events: DowntimeEvent[];
  handovers: Array<{
    id: string;
    machine_id: string;
    previous_shift_name: string;
    incoming_shift_name: string;
    status: string;
    outgoing_operator: string | null;
    acknowledged_by_name: string | null;
    created_at: string;
  }>;
}

export interface QrPassportData {
  machine: {
    id: string;
    code: string;
    name: string;
    machine_type: string;
    qr_token: string;
    line_id: string;
    line_name: string;
    factory_id: string;
    factory_name: string;
    region_id: string;
    region_name: string;
  };
  specification: MachineSpecification | null;
  state: MachineState | null;
  health: MachineHealth;
  energy: MachineEnergy;
  recent_abnormalities: Array<{ id: number; code: string; title: string; severity: string; status: string; created_at: string }>;
  maintenance_history: Array<{ id: number; type: string; summary: string; status: string; engineer_name: string | null; started_at: string }>;
  production_summary: { recent_entries: number; total_units: number; total_rejects: number; good_units: number };
  current_handover: { id: string; status: string; previous_shift: string; incoming_shift: string; outgoing_operator: string | null } | null;
  safety_checklist_status: SafetyChecklist | null;
}

export interface ShiftRosterResponse {
  assignments: OperatorAssignment[];
  pending_handovers: Array<{
    id: string;
    machine_id: string;
    factory_id: string;
    previous_shift_name: string;
    incoming_shift_name: string;
    outgoing_operator: string | null;
    incoming_operator: string | null;
    pending_abnormalities_count: number;
    created_at: string;
  }>;
  regional_shifts: Array<{ region_id: string; region_name: string; context: ShiftContext }>;
}

export interface FactoryAnalyticsResponse {
  scope: {
    machines_count: number;
    region_id: string | null;
    factory_id: string | null;
    line_id: string | null;
    machine_id: string | null;
    shift_name: string | null;
  };
  kpis: {
    overall_oee: number;
    availability_pct: number;
    performance_pct: number;
    quality_pct: number;
    total_actual_production: number;
    total_target_production: number;
    total_rejected_units: number;
    total_good_production: number;
    target_achievement_pct: number;
    planned_downtime_min: number;
    unplanned_downtime_min: number;
    total_downtime_min: number;
    avg_machine_health_score: number;
    pending_handovers: number;
    maintenance_overdue_count: number;
    total_power_kw: number;
  };
  health_distribution: Record<string, number>;
  line_comparison: Array<{
    line_id: string;
    line_code: string;
    line_name: string;
    factory_name: string;
    actual: number;
    target: number;
    achievement_pct: number;
    avg_oee: number;
  }>;
  shift_production_summary: Array<{
    shift_name: string;
    actual: number;
    target: number;
    rejects: number;
    good: number;
    entries: number;
    achievement_pct: number;
  }>;
  top_downtime_causes: Array<{ reason_category: string; duration_minutes: number }>;
  quality_by_category: Array<{
    defect_category: string;
    rejected_qty: number;
    reworked_qty: number;
    inspected_qty: number;
  }>;
}

export interface UserHistoryResponse {
  user: UserAccount;
  assignments: Array<{
    id: number;
    machine_id: string | null;
    line_id: string | null;
    factory_id: string | null;
    shift_name: string | null;
    is_active: boolean;
    assigned_by_name: string | null;
    created_at: string;
  }>;
  production_entries: Array<{
    id: number;
    machine_id: string;
    shift_name: string;
    units_produced: number;
    recorded_at: string;
  }>;
  handovers: Array<{
    id: string;
    machine_id: string;
    status: string;
    previous_shift_name: string;
    incoming_shift_name: string;
    created_at: string;
  }>;
}

// Phase 5 Centralized Admin & Factory Reports Types
export interface CentralizedReportItem {
  report_uid: string;
  category: string;
  category_label: string;
  title: string;
  company_name: string;
  region_id: string | null;
  region_name: string;
  factory_id: string | null;
  factory_name: string;
  line_id: string | null;
  line_name: string;
  machine_id: string | null;
  machine_code: string;
  machine_name: string;
  shift_name: string;
  operator_or_actor: string;
  supervisor_name: string;
  status: string;
  recorded_at: string;
  existing_pdf_filename: string | null;
  summary_line: string;
  raw_details: Record<string, unknown>;
}

export interface CentralizedReportsSummary {
  total_reports: number;
  pending_handovers: number;
  acknowledged_handovers: number;
  open_abnormalities: number;
  maintenance_reports: number;
  factories_covered: number;
}

export interface CentralizedReportsResponse {
  summary: CentralizedReportsSummary;
  reports: CentralizedReportItem[];
}

export interface CentralizedReportPreview {
  report: CentralizedReportItem;
  context: {
    production_records: Array<{
      shift_name: string;
      units_produced: number;
      target_units: number;
      reject_units: number;
      operator_name: string | null;
      recorded_at: string;
    }>;
    abnormalities: Array<{
      code: string;
      title: string;
      severity: string;
      status: string;
      created_at: string;
    }>;
    maintenance_records: Array<{
      type: string;
      summary: string;
      status: string;
      engineer_name: string | null;
      started_at: string;
    }>;
    latest_handover: {
      id: string;
      status: string;
      previous_shift: string;
      incoming_shift: string;
      outgoing_operator: string | null;
      acknowledged_by: string | null;
      acknowledged_at: string | null;
    } | null;
    audit_events: Array<{
      action: string;
      actor_name: string | null;
      details: string;
      created_at: string;
    }>;
  };
}

// Google Maps Operations + Individual Operator Profile Types
export interface PersonnelAssignedLine {
  id: string;
  name: string;
  code?: string;
  factory_id?: string | null;
  factory_name?: string | null;
}

export interface PersonnelAssignedMachine {
  id: string;
  code: string;
  name: string;
  machine_type?: string;
  status: string;
  oee_pct?: number;
  line_id?: string | null;
  line_name?: string | null;
  factory_id?: string | null;
  factory_name?: string | null;
  region_id?: string | null;
  region_name?: string | null;
  shift_name: string | null;
}

export interface PersonnelSummary {
  id: number;
  name: string;
  email: string;
  role: string;
  employee_id: string | null;
  is_active: boolean;
  assigned_region_id: string | null;
  assigned_region_name: string | null;
  assigned_factory_id: string | null;
  assigned_factory_name: string | null;
  current_shift: string | null;
  assignment_status: string;
  assigned_lines: PersonnelAssignedLine[];
  assigned_machines: PersonnelAssignedMachine[];
}

export interface PersonnelAssignmentDetail {
  id: number;
  machine_id: string | null;
  machine_code: string | null;
  machine_name: string | null;
  line_id: string | null;
  line_name: string | null;
  factory_id: string | null;
  factory_name: string | null;
  region_id: string | null;
  region_name: string | null;
  shift_name: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  assigned_by_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface PersonnelDetail {
  user: UserAccount & {
    assigned_region_name: string | null;
    assigned_factory_name: string | null;
  };
  current_shift: string | null;
  assignment_status: string;
  assigned_lines: PersonnelAssignedLine[];
  assigned_machines: PersonnelAssignedMachine[];
  assignments: PersonnelAssignmentDetail[];
  recent_production_reports: Array<
    ProductionEntry & { machine_code: string; machine_name: string }
  >;
  recent_abnormalities: Abnormality[];
  handover_records: HandoverRecord[];
  audit_authorized: boolean;
  recent_audit_events: AuditEvent[];
}
