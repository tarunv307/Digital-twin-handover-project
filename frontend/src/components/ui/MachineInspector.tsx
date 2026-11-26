import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileDown,
  HeartPulse,
  Lock,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { digitalTwinApi } from "../../services/api";
import { useTwinStore } from "../../store/twinStore";
import { StatusBadge } from "./StatusBadge";
import { MetricChip } from "./MetricChip";
import type {
  MachineDetail,
  MachineWorkspace,
  SafetyChecklistItemInput,
  SensorReading,
} from "../../types/digitalTwin";

type InspectorTab =
  | "overview"
  | "operations"
  | "abnormalities"
  | "downtime_quality"
  | "safety"
  | "pm_planner"
  | "health_energy"
  | "handover";

interface MachineInspectorProps {
  machine: MachineDetail;
  onRefresh: () => void;
  defaultTab?: InspectorTab;
}

const valOrUnconfigured = (v: string | number | null | undefined, suffix = "") => {
  if (v === null || v === undefined || v === "") return "Not configured";
  return `${v}${suffix}`;
};

const TemperatureSparkline: React.FC<{ readings: SensorReading[] }> = ({ readings }) => {
  const temps = readings.map((r) => r.temperature_c).filter((t): t is number => t !== null);
  if (temps.length < 2) {
    return <div className="text-xs text-slate-400">Insufficient historical readings</div>;
  }
  const min = Math.min(...temps) - 2;
  const max = Math.max(...temps) + 2;
  const range = Math.max(max - min, 1);
  const w = 320;
  const h = 58;
  const pts = temps
    .map((t, i) => {
      const x = (i / (temps.length - 1)) * w;
      const y = h - ((t - min) / range) * (h - 10) - 5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full overflow-visible">
      <polyline fill="none" stroke="#1d4ed8" strokeWidth="2" points={pts} />
    </svg>
  );
};

export const MachineInspector: React.FC<MachineInspectorProps> = ({
  machine,
  onRefresh,
  defaultTab = "overview",
}) => {
  const navigate = useNavigate();
  const { liveStates, currentUser, setAuthModalOpen, triggerStructuralRefresh } = useTwinStore();
  const [tab, setTab] = useState<InspectorTab>(defaultTab);
  const [workspace, setWorkspace] = useState<MachineWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Operational form states
  const [prodUnits, setProdUnits] = useState("145");
  const [prodRejects, setProdRejects] = useState("1");
  const [prodDowntime, setProdDowntime] = useState("3");
  const [prodRemarks, setProdRemarks] = useState("");

  const [abnTitle, setAbnTitle] = useState("");
  const [abnDesc, setAbnDesc] = useState("");
  const [abnSeverity, setAbnSeverity] = useState<"low" | "medium" | "high" | "critical">("high");

  const [mntSummary, setMntSummary] = useState("");
  const [mntType, setMntType] = useState<"preventive" | "corrective" | "calibration">("corrective");

  const [hoRemarks, setHoRemarks] = useState("");
  const [ackRemarks, setAckRemarks] = useState("");
  const [ackConfirmed, setAckConfirmed] = useState(true);

  // Downtime & Quality states
  const [dtCat, setDtCat] = useState<"planned" | "unplanned">("unplanned");
  const [dtReasonCat, setDtReasonCat] = useState("mechanical");
  const [dtDetail, setDtDetail] = useState("");
  const [dtDuration, setDtDuration] = useState("12");

  const [qiInspected, setQiInspected] = useState("50");
  const [qiRejected, setQiRejected] = useState("1");
  const [qiReworked, setQiReworked] = useState("1");
  const [qiCategory, setQiCategory] = useState("dimensional");
  const [qiRemarks, setQiRemarks] = useState("");

  // Safety Checklist states
  const [safetyItems, setSafetyItems] = useState<SafetyChecklistItemInput[]>([
    { key: "estop", label: "Emergency Stop Mushroom Tested", response: "pass", critical: true },
    { key: "interlock", label: "Safety Guard & Door Interlock", response: "pass", critical: true },
    { key: "loto", label: "Lockout/Tagout & Grounding Check", response: "pass", critical: true },
    { key: "coolant_leak", label: "Coolant / Hydraulic Leak Inspection", response: "pass", critical: false },
    { key: "ppe_5s", label: "Operator PPE & Station Clear", response: "pass", critical: false },
  ]);
  const [safetyRemarks, setSafetyRemarks] = useState("");

  // PM Planner states
  const [pmTitle, setPmTitle] = useState("");
  const [pmType, setPmType] = useState<"preventive" | "corrective" | "calibration">("preventive");
  const [pmFreq, setPmFreq] = useState("30");
  const [pmDueDate, setPmDueDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));

  const loadWorkspace = useCallback(async () => {
    setWorkspaceError(null);
    try {
      const data = await digitalTwinApi.getMachineWorkspace(machine.id);
      setWorkspace(data);
    } catch (err) {
      setWorkspace(null);
      setWorkspaceError((err as Error).message);
    }
  }, [machine.id]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const st = liveStates[machine.id] ?? machine.state;
  const spec = machine.specification;

  // Merge live WebSocket readings onto recent_readings so the sparkline updates on every simulation tick
  const liveSparkReadings: SensorReading[] = React.useMemo(() => {
    const base = [...machine.recent_readings];
    const live = liveStates[machine.id];
    if (live && live.last_sync_at) {
      const lastTs = base[base.length - 1]?.timestamp;
      if (lastTs !== live.last_sync_at) {
        base.push({
          id: Date.now(),
          machine_id: machine.id,
          timestamp: live.last_sync_at,
          status: live.status,
          temperature_c: live.temperature_c,
          vibration_mm_s: live.vibration_mm_s,
          cycle_time_sec: live.cycle_time_sec,
          energy_kw: live.energy_kw,
          production_count: live.production_count,
          data_source: live.data_source,
        });
      }
    }
    return base.slice(-24);
  }, [machine.id, machine.recent_readings, liveStates]);

  const runWithFeedback = async (okMsg: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      await loadWorkspace();
      onRefresh();
      triggerStructuralRefresh();
      setNotice({ type: "ok", text: okMsg });
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const requireAuthOrPrompt = () => {
    if (!currentUser) {
      setAuthModalOpen(true);
      return false;
    }
    return true;
  };

  const pendingHandover = workspace?.handovers.find((h) => h.status === "pending") ?? null;
  const latestHandover = workspace?.handovers[0] ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Machine Header */}
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-800">
                {machine.code}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Station {String(machine.sequence_order).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/digital-twin/qr/${machine.qr_token}`)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-blue-700 hover:bg-blue-50"
                title="Open QR Machine Passport"
              >
                <QrCode className="h-3 w-3" />
                {machine.qr_token}
              </button>
            </div>
            <h2 className="mt-1 text-base font-bold text-slate-900">{machine.name}</h2>
            <p className="text-xs text-slate-500">
              {machine.region_name} / {machine.factory_name} / {machine.line_name}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={st?.status} />
            <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-blue-800">
              Source: {st?.data_source ?? "unknown"}
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { id: "overview", label: "Overview & Specs" },
            { id: "operations", label: "Production, 5S & Maint." },
            {
              id: "abnormalities",
              label: `Abnormalities (${workspace?.abnormalities.filter((a) => a.status !== "resolved").length ?? 0})`,
            },
            { id: "downtime_quality", label: "Downtime & Quality" },
            { id: "safety", label: "Safety Checklist" },
            { id: "pm_planner", label: "PM Planner" },
            { id: "health_energy", label: "Health & Energy" },
            {
              id: "handover",
              label: pendingHandover ? "Shift Handover • PENDING" : "Shift Handover",
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as InspectorTab)}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition ${
                tab === t.id
                  ? "bg-blue-700 text-white"
                  : t.id === "handover" && pendingHandover
                    ? "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback & Scope Notice Banners */}
      {workspaceError && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
          <div className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-700" />
            <span>{workspaceError}</span>
          </div>
          {!currentUser && (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="rounded bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              Sign In
            </button>
          )}
        </div>
      )}
      {notice && (
        <div
          className={`border-b px-5 py-2 text-xs font-medium ${
            notice.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === "overview" && (
          <div className="space-y-5">
            {st?.status === "Fault" && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div>
                    <div className="font-semibold">Active Fault {st.active_fault_code ?? "FAULT"}</div>
                    <div className="text-red-700">{st.active_fault_message ?? "Abnormality detected"}</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runWithFeedback("Machine recovered to Running.", () => digitalTwinApi.recoverMachine(machine.id))}
                  className="shrink-0 rounded bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800"
                >
                  Clear & Recover
                </button>
              </div>
            )}

            {/* Simulation Controls */}
            <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Simulation State Controls
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runWithFeedback("Simulated fault E-402 triggered.", () => digitalTwinApi.triggerFault(machine.id))}
                    className="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Trigger Fault
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runWithFeedback("Machine set to Maintenance.", () => digitalTwinApi.setMachineStatus(machine.id, "Maintenance"))
                    }
                    className="inline-flex items-center gap-1 rounded border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Maintenance
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runWithFeedback("Machine set to Running.", () => digitalTwinApi.recoverMachine(machine.id))}
                    className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Set Running
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRefresh();
                      loadWorkspace();
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </section>

            {/* Operational Telemetry */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Live Operational Telemetry & OEE
                </h3>
                <span className="font-mono text-[11px] text-slate-500">
                  Last sync: {st?.last_sync_at ? new Date(st.last_sync_at).toLocaleTimeString() : "Unavailable"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <MetricChip
                  label="Production"
                  value={`${st?.production_count ?? 0}/${st?.production_target ?? 0}`}
                  unit="pcs"
                  tone="accent"
                />
                <MetricChip label="OEE" value={st?.oee_pct ?? 0} unit="%" tone="success" />
                <MetricChip
                  label="Temperature"
                  value={st?.temperature_c ?? "—"}
                  unit="°C"
                  tone={(st?.temperature_c ?? 0) > 70 ? "danger" : "default"}
                />
                <MetricChip
                  label="Vibration"
                  value={st?.vibration_mm_s ?? "—"}
                  unit="mm/s"
                  tone={(st?.vibration_mm_s ?? 0) > 4.5 ? "danger" : "default"}
                />
                <MetricChip label="Availability" value={st?.availability_pct ?? 0} unit="%" />
                <MetricChip label="Performance" value={st?.performance_pct ?? 0} unit="%" />
                <MetricChip label="Quality" value={st?.quality_pct ?? 0} unit="%" />
                <MetricChip label="Downtime" value={st?.downtime_min ?? 0} unit="min" />
              </div>

              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                  <span className="font-medium">Thermal Trend</span>
                  <span className="font-mono">
                    Shift: {machine.shift_context?.current_shift?.shift_name ?? "—"} • Op:{" "}
                    {st?.assigned_operator ?? "Unassigned"}
                  </span>
                </div>
                <TemperatureSparkline readings={liveSparkReadings} />
              </div>
            </section>

            {/* Technical Specifications */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Cpu className="h-4 w-4 text-slate-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Technical Specifications (DB Configured)
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-white p-3.5 text-xs sm:grid-cols-2">
                {[
                  ["Manufacturer", valOrUnconfigured(spec?.manufacturer)],
                  ["Model", valOrUnconfigured(spec?.model)],
                  ["Serial Number", valOrUnconfigured(spec?.serial_number)],
                  ["Category", valOrUnconfigured(spec?.category)],
                  ["Installation Date", valOrUnconfigured(spec?.installation_date)],
                  ["Rated Capacity", valOrUnconfigured(spec?.rated_capacity_units_hr, " units/hr")],
                  ["Protocol", valOrUnconfigured(spec?.communication_protocol)],
                  ["Maintenance Interval", valOrUnconfigured(spec?.maintenance_interval_hours, " hrs")],
                  ["Last Maintenance", valOrUnconfigured(spec?.last_maintenance_date)],
                  ["Responsible Dept.", valOrUnconfigured(spec?.responsible_department)],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between gap-2 border-b border-slate-100 py-1.5">
                    <span className="text-slate-500">{label}</span>
                    <span
                      className={`text-right font-medium ${
                        val === "Not configured" ? "italic text-slate-400" : "font-mono text-slate-900"
                      }`}
                    >
                      {val}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "operations" && (
          <div className="space-y-5">
            {/* Production Entry */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Log Shift Production Entry (Updates Machine OEE)
              </h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Units Produced</label>
                  <input
                    type="number"
                    value={prodUnits}
                    onChange={(e) => setProdUnits(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Rejects</label>
                  <input
                    type="number"
                    value={prodRejects}
                    onChange={(e) => setProdRejects(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-600">Downtime (min)</label>
                  <input
                    type="number"
                    value={prodDowntime}
                    onChange={(e) => setProdDowntime(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={prodRemarks}
                  onChange={(e) => setProdRemarks(e.target.value)}
                  placeholder="Shift production remarks (batch, SPC notes)..."
                  className="flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!requireAuthOrPrompt()) return;
                    runWithFeedback("Production entry saved and synced to OEE.", () =>
                      digitalTwinApi.recordProduction({
                        machine_id: machine.id,
                        units_produced: Number(prodUnits) || 0,
                        reject_units: Number(prodRejects) || 0,
                        downtime_minutes: Number(prodDowntime) || 0,
                        remarks: prodRemarks || undefined,
                      })
                    );
                  }}
                  className="rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Submit Production
                </button>
              </div>
            </section>

            {/* Cleaning & 5S Quick Log */}
            <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Cleaning & 5S Safety Verification
                </h3>
                <p className="text-[11px] text-slate-500">
                  Latest:{" "}
                  {workspace?.cleaning_logs[0]
                    ? `${workspace.cleaning_logs[0].logged_by_name} (${new Date(
                        workspace.cleaning_logs[0].logged_at
                      ).toLocaleTimeString()})`
                    : "No 5S log recorded yet"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!requireAuthOrPrompt()) return;
                  runWithFeedback("5S cleaning & safety checklist logged.", () =>
                    digitalTwinApi.createCleaning5S({
                      machine_id: machine.id,
                      area_cleaned: true,
                      lubrication_checked: true,
                      guards_verified: true,
                      safety_observations: "5S chip tray cleared & safety interlocks verified.",
                    })
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Verify & Log 5S
              </button>
            </section>

            {/* Maintenance History & Creation */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Maintenance Workflow & History ({workspace?.maintenance_records.length ?? 0})
              </h3>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <select
                  value={mntType}
                  onChange={(e) => setMntType(e.target.value as typeof mntType)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="corrective">Corrective</option>
                  <option value="preventive">Preventive</option>
                  <option value="calibration">Calibration</option>
                </select>
                <input
                  type="text"
                  value={mntSummary}
                  onChange={(e) => setMntSummary(e.target.value)}
                  placeholder="Maintenance activity summary..."
                  className="min-w-[180px] flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !mntSummary.trim()}
                  onClick={() => {
                    if (!requireAuthOrPrompt()) return;
                    runWithFeedback("Maintenance record created.", async () => {
                      await digitalTwinApi.createMaintenance({
                        machine_id: machine.id,
                        maintenance_type: mntType,
                        status: "in_progress",
                        summary: mntSummary,
                      });
                      setMntSummary("");
                    });
                  }}
                  className="rounded bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40"
                >
                  Log Maintenance
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {workspace?.maintenance_records.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{rec.summary}</div>
                      <div className="text-[11px] text-slate-500">
                        {rec.maintenance_type} • {rec.engineer_name ?? "Engineer"} • {rec.status}
                      </div>
                    </div>
                    {rec.status !== "completed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!requireAuthOrPrompt()) return;
                          runWithFeedback("Maintenance marked completed.", () =>
                            digitalTwinApi.updateMaintenance(rec.id, { status: "completed" })
                          );
                        }}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                      >
                        Complete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "abnormalities" && (
          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-800">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                Report Machine Abnormality
              </div>
              <div className="mt-2.5 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={abnTitle}
                    onChange={(e) => setAbnTitle(e.target.value)}
                    placeholder="Abnormality title (e.g., Spindle thermal alarm E-402)"
                    className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={abnSeverity}
                    onChange={(e) => setAbnSeverity(e.target.value as typeof abnSeverity)}
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <textarea
                  value={abnDesc}
                  onChange={(e) => setAbnDesc(e.target.value)}
                  rows={2}
                  placeholder="Describe symptom, readings, and containment action..."
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !abnTitle.trim()}
                  onClick={() => {
                    if (!requireAuthOrPrompt()) return;
                    runWithFeedback("Abnormality record created and linked to Digital Twin.", async () => {
                      await digitalTwinApi.createAbnormality({
                        machine_id: machine.id,
                        title: abnTitle,
                        description: abnDesc || abnTitle,
                        severity: abnSeverity,
                      });
                      setAbnTitle("");
                      setAbnDesc("");
                    });
                  }}
                  className="rounded bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                >
                  Create Abnormality Record
                </button>
              </div>
            </section>

            <section className="space-y-2">
              {workspace?.abnormalities.length === 0 ? (
                <p className="text-xs text-slate-400">No abnormalities logged for this machine.</p>
              ) : (
                workspace?.abnormalities.map((a) => (
                  <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-red-700">{a.code}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                          {a.severity}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            a.status === "resolved"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {a.status}
                        </span>
                      </div>
                      {a.status !== "resolved" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!requireAuthOrPrompt()) return;
                            runWithFeedback(`Abnormality ${a.code} resolved.`, () =>
                              digitalTwinApi.updateAbnormality(a.id, {
                                status: "resolved",
                                resolution_notes: "Inspected, corrected, and verified during shift check.",
                              })
                            );
                          }}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                    <div className="mt-1 font-semibold text-slate-900">{a.title}</div>
                    <p className="mt-0.5 text-slate-600">{a.description}</p>
                    <div className="mt-1.5 text-[11px] text-slate-400">
                      Reported by {a.reported_by_name ?? "Operator"} • {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {tab === "handover" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Machine Shift Handover Workflow
              </div>
              <button
                type="button"
                onClick={() => navigate(`/digital-twin/machine/${machine.id}/handover`)}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Open Dedicated Handover View →
              </button>
            </div>

            {/* Generate New Handover Report */}
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
              <div className="font-semibold text-slate-900">Generate Outgoing Shift Handover Report</div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Compiles production, abnormalities, maintenance, and 5S logs into a 4-section grounded report & PDF.
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={hoRemarks}
                  onChange={(e) => setHoRemarks(e.target.value)}
                  placeholder="Outgoing operator remarks for incoming shift..."
                  className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!requireAuthOrPrompt()) return;
                    runWithFeedback("Shift handover generated and PDF exported.", async () => {
                      await digitalTwinApi.generateHandover({
                        machine_id: machine.id,
                        operator_remarks: hoRemarks || undefined,
                      });
                      setHoRemarks("");
                    });
                  }}
                  className="rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Generate Handover
                </button>
              </div>
            </section>

            {/* Incoming Operator Acknowledgement Card */}
            {pendingHandover && (
              <section className="rounded-lg border-2 border-amber-300 bg-amber-50/70 p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold text-amber-900">
                    <ClipboardCheck className="h-4 w-4 text-amber-700" />
                    Pending Incoming Handover: {pendingHandover.id}
                  </div>
                  {pendingHandover.pdf_filename && (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={`/api/download/${pendingHandover.pdf_filename}?inline=true`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Preview PDF
                      </a>
                      <a
                        href={`/api/download/${pendingHandover.pdf_filename}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FileDown className="h-3.5 w-3.5 text-red-600" />
                        Download PDF
                      </a>
                    </div>
                  )}
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2 rounded border border-amber-200 bg-white p-2.5 text-[11px]">
                  <div>
                    <span className="text-slate-500">Previous Shift:</span>{" "}
                    <strong>{pendingHandover.previous_shift_name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Incoming Shift:</span>{" "}
                    <strong>{pendingHandover.incoming_shift_name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Outgoing Op:</span>{" "}
                    <strong>{pendingHandover.outgoing_operator ?? "—"}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Production:</span>{" "}
                    <strong>
                      {pendingHandover.production_completed}/{pendingHandover.production_target}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Condition:</span>{" "}
                    <strong>{pendingHandover.machine_condition}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Open Abnormalities:</span>{" "}
                    <strong className="text-red-700">{pendingHandover.pending_abnormalities_count}</strong>
                  </div>
                </div>

                <div className="mt-2 space-y-1 text-[11px] text-slate-700">
                  <div>
                    <strong>Remarks:</strong> {pendingHandover.operator_remarks}
                  </div>
                  <div>
                    <strong>Required Inspection:</strong> {pendingHandover.required_inspection}
                  </div>
                  <div>
                    <strong>Maintenance Instructions:</strong> {pendingHandover.maintenance_instructions}
                  </div>
                </div>

                <div className="mt-3 space-y-2 border-t border-amber-200 pt-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={ackConfirmed}
                      onChange={(e) => setAckConfirmed(e.target.checked)}
                    />
                    I confirm machine condition, safety checks, and pending abnormality instructions
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ackRemarks}
                      onChange={(e) => setAckRemarks(e.target.value)}
                      placeholder="Incoming operator acknowledgement remarks..."
                      className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      disabled={busy || !ackConfirmed}
                      onClick={() => {
                        if (!requireAuthOrPrompt()) return;
                        runWithFeedback(
                          `Handover ${pendingHandover.id} acknowledged and logged in audit trail.`,
                          async () => {
                            await digitalTwinApi.acknowledgeHandover(pendingHandover.id, {
                              remarks: ackRemarks || undefined,
                              condition_confirmed: ackConfirmed,
                            });
                            setAckRemarks("");
                          }
                        );
                      }}
                      className="rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                    >
                      {currentUser ? "Acknowledge Handover" : "Sign In to Acknowledge"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Grounded 4-Section Handover Preview & History */}
            {latestHandover?.grounded_report_json && (
              <section className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900">
                    Latest Handover Report ({latestHandover.id}) —{" "}
                    <span className={latestHandover.status === "acknowledged" ? "text-emerald-700" : "text-amber-700"}>
                      {latestHandover.status.toUpperCase()}
                    </span>
                  </div>
                  {latestHandover.pdf_filename && (
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/download/${latestHandover.pdf_filename}?inline=true`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-blue-700 hover:underline"
                      >
                        Preview
                      </a>
                      <a
                        href={`/api/download/${latestHandover.pdf_filename}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                      >
                        <FileDown className="h-3.5 w-3.5 text-red-600" />
                        Download PDF
                      </a>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-600">{latestHandover.grounded_report_json.summary}</p>
                {latestHandover.acknowledged_by_name && (
                  <p className="mt-1 text-[11px] font-medium text-emerald-700">
                    Acknowledged by {latestHandover.acknowledged_by_name} at{" "}
                    {latestHandover.acknowledged_at
                      ? new Date(latestHandover.acknowledged_at).toLocaleString()
                      : ""}
                  </p>
                )}
              </section>
            )}
          </div>
        )}

        {tab === "downtime_quality" && (
          <div className="space-y-5">
            {/* Downtime Loss Form */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Log Machine Downtime Event (OEE Impact)
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select
                  value={dtCat}
                  onChange={(e) => setDtCat(e.target.value as "planned" | "unplanned")}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="unplanned">Unplanned Downtime</option>
                  <option value="planned">Planned Changeover / PM</option>
                </select>
                <select
                  value={dtReasonCat}
                  onChange={(e) => setDtReasonCat(e.target.value)}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="mechanical">Mechanical</option>
                  <option value="electrical">Electrical / Sensor</option>
                  <option value="tooling">Tooling / Insert Change</option>
                  <option value="changeover">Setup / Changeover</option>
                  <option value="material_wait">Material Wait</option>
                </select>
                <input
                  type="number"
                  min={0}
                  value={dtDuration}
                  onChange={(e) => setDtDuration(e.target.value)}
                  placeholder="Duration (min)"
                  className="rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
              <input
                value={dtDetail}
                onChange={(e) => setDtDetail(e.target.value)}
                placeholder="Downtime root cause or stoppage detail…"
                className="mt-2 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={busy || !dtDetail.trim()}
                onClick={() => {
                  if (!requireAuthOrPrompt()) return;
                  runWithFeedback("Downtime event recorded.", async () => {
                    await digitalTwinApi.createDowntime({
                      machine_id: machine.id,
                      category: dtCat,
                      reason_category: dtReasonCat,
                      reason_detail: dtDetail,
                      duration_minutes: Number(dtDuration) || 0,
                    });
                    setDtDetail("");
                  });
                }}
                className="mt-2.5 rounded bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                Log Downtime
              </button>

              <div className="mt-4 space-y-1.5">
                {(workspace?.downtime_events ?? []).map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold uppercase">{d.category}</span> •{" "}
                      <span className="capitalize">{d.reason_category}</span> — {d.reason_detail}
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span>{d.duration_minutes}m</span>
                      {d.status === "open" ? (
                        <button
                          type="button"
                          onClick={() =>
                            runWithFeedback("Downtime closed & machine resumed.", () =>
                              digitalTwinApi.updateDowntime(d.id, { status: "closed", duration_minutes: d.duration_minutes || 10 })
                            )
                          }
                          className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white"
                        >
                          Close
                        </button>
                      ) : (
                        <span className="text-[10px] uppercase text-slate-500">Closed</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Quality Inspection Form */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Quality & Defect Inspection Log
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="text-[10px] text-slate-500">Inspected</label>
                  <input
                    type="number"
                    value={qiInspected}
                    onChange={(e) => setQiInspected(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Rejected</label>
                  <input
                    type="number"
                    value={qiRejected}
                    onChange={(e) => setQiRejected(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Reworked</label>
                  <input
                    type="number"
                    value={qiReworked}
                    onChange={(e) => setQiReworked(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500">Defect Category</label>
                  <select
                    value={qiCategory}
                    onChange={(e) => setQiCategory(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="dimensional">Dimensional</option>
                    <option value="surface_finish">Surface Finish</option>
                    <option value="burr">Burr / Edge</option>
                    <option value="alignment">Alignment</option>
                  </select>
                </div>
              </div>
              <input
                value={qiRemarks}
                onChange={(e) => setQiRemarks(e.target.value)}
                placeholder="Gauge / inspection notes…"
                className="mt-2 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!requireAuthOrPrompt()) return;
                  runWithFeedback("Quality inspection logged.", async () => {
                    await digitalTwinApi.createQualityInspection({
                      machine_id: machine.id,
                      inspected_qty: Number(qiInspected) || 1,
                      rejected_qty: Number(qiRejected) || 0,
                      reworked_qty: Number(qiReworked) || 0,
                      defect_category: qiCategory,
                      remarks: qiRemarks || undefined,
                    });
                    setQiRemarks("");
                  });
                }}
                className="mt-2.5 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
              >
                Save Quality Inspection
              </button>
              <div className="mt-3 space-y-1">
                {(workspace?.quality_inspections ?? []).map((q) => (
                  <div key={q.id} className="flex justify-between rounded bg-slate-50 px-3 py-1.5 text-xs">
                    <span className="capitalize">
                      {q.defect_category} • {q.inspected_qty} chk ({q.rejected_qty} rej, {q.reworked_qty} rw)
                    </span>
                    <span className="text-slate-500">{q.inspector_name}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "safety" && (
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Start-of-Shift Digital Safety Checklist
                </h3>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Critical safety failures automatically escalate to a Critical Abnormality and place the machine Twin in
                Fault state for supervisor review.
              </p>

              <div className="mt-3 space-y-2">
                {safetyItems.map((it, idx) => (
                  <div key={it.key} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900">{it.label}</span>{" "}
                      {it.critical && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">CRITICAL</span>
                      )}
                    </div>
                    <select
                      value={it.response}
                      onChange={(e) => {
                        const next = [...safetyItems];
                        next[idx] = { ...it, response: e.target.value as "pass" | "fail" | "na" };
                        setSafetyItems(next);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                    >
                      <option value="pass">PASS</option>
                      <option value="fail">FAIL</option>
                      <option value="na">N/A</option>
                    </select>
                  </div>
                ))}
              </div>
              <input
                value={safetyRemarks}
                onChange={(e) => setSafetyRemarks(e.target.value)}
                placeholder="Safety pre-start remarks…"
                className="mt-2.5 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!requireAuthOrPrompt()) return;
                  runWithFeedback("Safety checklist submitted.", async () => {
                    await digitalTwinApi.submitSafetyChecklist({
                      machine_id: machine.id,
                      items: safetyItems,
                      operator_remarks: safetyRemarks || undefined,
                    });
                    setSafetyRemarks("");
                  });
                }}
                className="mt-3 rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                Submit Safety Checklist
              </button>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">Submitted Checklists</h3>
              <div className="space-y-2 text-xs">
                {(workspace?.safety_checklists ?? []).map((sc) => (
                  <div key={sc.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div>
                      <div className="font-semibold">
                        {sc.shift_name} •{" "}
                        <span className={sc.has_critical_failure ? "text-red-700" : "text-emerald-700"}>
                          {sc.overall_status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Submitted by {sc.submitted_by_name} • Review: {sc.supervisor_review_status}
                      </div>
                    </div>
                    {sc.supervisor_review_status === "pending" &&
                      currentUser &&
                      ["company_admin", "regional_manager", "factory_supervisor"].includes(currentUser.role) && (
                        <button
                          type="button"
                          onClick={() =>
                            runWithFeedback("Safety checklist reviewed.", () =>
                              digitalTwinApi.reviewSafetyChecklist(sc.id, { supervisor_review_status: "reviewed" })
                            )
                          }
                          className="rounded bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                        >
                          Supervisor Approve
                        </button>
                      )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === "pm_planner" && (
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-sky-700" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Preventive Maintenance Schedule
                </h3>
              </div>
              <div className="mt-3 space-y-2 text-xs">
                {(workspace?.maintenance_schedules ?? []).map((s) => (
                  <div
                    key={s.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded border p-3 ${
                      s.is_overdue ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        {s.title} ({s.maintenance_type})
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Due: {new Date(s.due_date).toLocaleDateString()} • Every {s.frequency_days}d • Status:{" "}
                        <strong>{s.is_overdue ? "OVERDUE" : s.status}</strong>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {s.status === "scheduled" && (
                        <button
                          type="button"
                          onClick={() =>
                            runWithFeedback("PM work order started.", () =>
                              digitalTwinApi.updateMaintenanceSchedule(s.id, { status: "in_progress" })
                            )
                          }
                          className="rounded bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                        >
                          Start PM
                        </button>
                      )}
                      {s.status !== "completed" && (
                        <button
                          type="button"
                          onClick={() =>
                            runWithFeedback("PM completed & logged to service history.", () =>
                              digitalTwinApi.updateMaintenanceSchedule(s.id, { status: "completed" })
                            )
                          }
                          className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                        >
                          Complete PM
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Create PM Schedule</h3>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  value={pmTitle}
                  onChange={(e) => setPmTitle(e.target.value)}
                  placeholder="Task title (e.g. Spindle Bearing Grease)"
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs sm:col-span-3"
                />
                <select
                  value={pmType}
                  onChange={(e) => setPmType(e.target.value as "preventive" | "corrective" | "calibration")}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="preventive">Preventive</option>
                  <option value="calibration">Calibration</option>
                  <option value="corrective">Corrective</option>
                </select>
                <input
                  type="number"
                  min={1}
                  value={pmFreq}
                  onChange={(e) => setPmFreq(e.target.value)}
                  placeholder="Interval Days"
                  className="rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                />
                <input
                  type="date"
                  value={pmDueDate}
                  onChange={(e) => setPmDueDate(e.target.value)}
                  className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <button
                type="button"
                disabled={busy || !pmTitle.trim()}
                onClick={() => {
                  if (!requireAuthOrPrompt()) return;
                  runWithFeedback("PM schedule created.", async () => {
                    await digitalTwinApi.createMaintenanceSchedule({
                      machine_id: machine.id,
                      title: pmTitle,
                      maintenance_type: pmType,
                      frequency_days: Number(pmFreq) || 30,
                      due_date: `${pmDueDate}T09:00:00Z`,
                    });
                    setPmTitle("");
                  });
                }}
                className="mt-2.5 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Schedule PM
              </button>
            </section>
          </div>
        )}

        {tab === "health_energy" && (
          <div className="space-y-5">
            {/* Explainable Machine Health */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HeartPulse className="h-4 w-4 text-rose-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Machine Health Score (Software Estimate)
                  </h3>
                </div>
                <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-xs font-bold text-blue-800">
                  {workspace?.health?.score ?? "—"} / 100 • {workspace?.health?.category ?? "—"}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {workspace?.health?.disclaimer ??
                  "Software-generated estimate based on simulated/recorded telemetry and operational logs."}
              </p>

              <div className="mt-3 space-y-1.5">
                {(workspace?.health?.factors ?? []).length === 0 ? (
                  <div className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    No active penalty factors — operating within configured thresholds.
                  </div>
                ) : (
                  (workspace?.health?.factors ?? []).map((f, i) => (
                    <div key={i} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-900">{f.factor}</span>
                        <div className="text-[11px] text-slate-600">{f.detail}</div>
                      </div>
                      <span className="font-mono font-bold text-red-700">{f.impact} pts</span>
                    </div>
                  ))
                )}
              </div>

              {(workspace?.health?.recommendations ?? []).length > 0 && (
                <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="font-bold text-slate-700">Suggested Actions:</div>
                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                    {workspace?.health?.recommendations?.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Energy Monitoring */}
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Energy Monitoring & Loss Intensity
                  </h3>
                </div>
                <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-700">
                  {workspace?.energy?.is_simulated ? "SIMULATED POWER TELEMETRY" : workspace?.energy?.data_source ?? "SIMULATED"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <MetricChip label="Current Draw" value={workspace?.energy?.current_kw ?? st?.energy_kw ?? 0} unit="kW" />
                <MetricChip label="Est. Shift Usage" value={workspace?.energy?.estimated_shift_kwh ?? 0} unit="kWh" />
                <MetricChip label="Intensity" value={workspace?.energy?.kwh_per_unit ?? 0} unit="kWh/pc" />
                <MetricChip
                  label="Idle/DT Loss"
                  value={workspace?.energy?.estimated_downtime_loss_kwh ?? 0}
                  unit="kWh"
                  tone="danger"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
