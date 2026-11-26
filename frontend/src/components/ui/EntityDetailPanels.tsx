import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  Cpu,
  Download,
  Factory,
  FileText,
  Gauge,
  Globe2,
  LogIn,
  MapPin,
  Thermometer,
  User as UserIcon,
  Wrench,
  Zap,
} from "lucide-react";
import { digitalTwinApi } from "../../services/api";
import { useTwinStore } from "../../store/twinStore";
import type {
  Abnormality,
  CentralizedReportItem,
  CompanyHierarchy,
  FactoryDetail,
  HandoverRecord,
  MachineDetail,
  MachineWorkspace,
  MaintenanceRecord,
  MaintenanceSchedule,
  PersonnelSummary,
  RegionTree,
} from "../../types/digitalTwin";
import { OperatorProfilePanel } from "./OperatorProfilePanel";
import { StatusBadge } from "./StatusBadge";

export type FactoryDetailTab =
  | "overview"
  | "machines"
  | "operators"
  | "reports"
  | "maintenance"
  | "handover";

interface RegionDetailPanelProps {
  region: RegionTree;
  liveStates: Record<string, { status: string; oee_pct?: number }>;
  onBack: () => void;
  onSelectFactory: (factoryId: string) => void;
}

export const RegionDetailPanel: React.FC<RegionDetailPanelProps> = ({
  region,
  liveStates,
  onBack,
  onSelectFactory,
}) => {
  const navigate = useNavigate();
  const machines = region.factories.flatMap((f) =>
    f.production_lines.flatMap((l) => l.machines)
  );
  const running = machines.filter((m) => (liveStates[m.id] ?? m.state)?.status === "Running").length;
  const faults = machines.filter((m) => (liveStates[m.id] ?? m.state)?.status === "Fault").length;
  const maintenance = machines.filter(
    (m) => (liveStates[m.id] ?? m.state)?.status === "Maintenance"
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" />
          All India
        </button>
        <span className="truncate font-mono text-[10px] text-slate-500">
          India / {region.name}
        </span>
      </div>

      <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase text-[#2563EB]">
              {region.code}
            </span>
            <h3 className="text-base font-bold text-[#14213D]">{region.name}</h3>
            {region.description && (
              <p className="mt-1 text-xs text-[#334155]">{region.description}</p>
            )}
          </div>
          <Globe2 className="h-5 w-5 shrink-0 text-[#2563EB]" />
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center font-mono text-xs">
          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
            <div className="text-[10px] text-slate-500">Plants</div>
            <div className="font-bold text-[#14213D]">{region.factories.length}</div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
            <div className="text-[10px] text-slate-500">Machines</div>
            <div className="font-bold text-[#14213D]">{machines.length}</div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
            <div className="text-[10px] text-slate-500">Running</div>
            <div className="font-bold text-emerald-700">{running}</div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
            <div className="text-[10px] text-slate-500">OEE</div>
            <div className="font-bold text-[#2563EB]">{region.summary.overall_oee}%</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#334155]">
          <span>Faults: <strong className={faults > 0 ? "text-red-600" : "text-emerald-700"}>{faults}</strong></span>
          <span>Maintenance: <strong>{maintenance}</strong></span>
          <span>Timezone: <strong>{region.timezone}</strong></span>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
          Factories in {region.name} ({region.factories.length})
        </h4>
        <div className="space-y-2">
          {region.factories.map((f) => {
            const fMachines = f.production_lines.flatMap((l) => l.machines);
            const fFaults = fMachines.filter(
              (m) => (liveStates[m.id] ?? m.state)?.status === "Fault"
            ).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectFactory(f.id)}
                className="flex w-full items-center justify-between rounded-xl border border-[#DCE6F2] bg-white p-3 text-left transition hover:border-[#2563EB] hover:bg-[#EAF2FC]/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Factory className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                    <span className="truncate text-xs font-bold text-[#14213D]">{f.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                    <MapPin className="h-3 w-3 text-slate-400" />
                    <span>{f.location_label ?? "India"}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-[11px]">
                  <div className="font-bold text-[#14213D]">{fMachines.length} machines</div>
                  <div className={fFaults > 0 ? "text-red-600" : "text-emerald-700"}>
                    {fFaults > 0 ? `${fFaults} Fault` : `${f.summary.overall_oee}% OEE`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate(`/digital-twin/region/${region.id}`)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
      >
        Open {region.name} Digital Twin
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

interface FactoryDetailPanelProps {
  factoryId: string;
  hierarchy: CompanyHierarchy | null;
  liveStates: Record<string, { status: string; oee_pct?: number }>;
  activeTab: FactoryDetailTab;
  onTabChange: (tab: FactoryDetailTab) => void;
  selectedUserId: number | null;
  onSelectUser: (userId: number | null) => void;
  onSelectMachine: (machineId: string) => void;
  onBack: () => void;
}

export const FactoryDetailPanel: React.FC<FactoryDetailPanelProps> = ({
  factoryId,
  hierarchy,
  liveStates,
  activeTab,
  onTabChange,
  selectedUserId,
  onSelectUser,
  onSelectMachine,
  onBack,
}) => {
  const navigate = useNavigate();
  const { currentUser, setAuthModalOpen } = useTwinStore();

  const [detail, setDetail] = useState<FactoryDetail | null>(null);
  const [abnormalities, setAbnormalities] = useState<Abnormality[]>([]);
  const [reports, setReports] = useState<CentralizedReportItem[]>([]);
  const [maintRecords, setMaintRecords] = useState<MaintenanceRecord[]>([]);
  const [maintSchedules, setMaintSchedules] = useState<MaintenanceSchedule[]>([]);
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    digitalTwinApi
      .getFactoryDetail(factoryId)
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [factoryId]);

  useEffect(() => {
    let active = true;
    digitalTwinApi
      .listAbnormalities({ factory_id: factoryId, limit: 25 })
      .then((rows) => {
        if (active) setAbnormalities(rows);
      })
      .catch(() => {});

    digitalTwinApi
      .listHandovers({ factory_id: factoryId })
      .then((rows) => {
        if (active) setHandovers(rows);
      })
      .catch(() => {});

    digitalTwinApi
      .listMaintenanceRecords({ factory_id: factoryId, limit: 25 })
      .then((rows) => {
        if (active) setMaintRecords(rows);
      })
      .catch(() => {});

    if (currentUser) {
      digitalTwinApi
        .listMaintenanceSchedules({ factory_id: factoryId })
        .then((rows) => {
          if (active) setMaintSchedules(rows);
        })
        .catch(() => {});

      digitalTwinApi
        .listCentralizedReports({ factory_id: factoryId })
        .then((res) => {
          if (active) setReports(res.reports.slice(0, 15));
        })
        .catch(() => {});
    } else {
      setMaintSchedules([]);
      setReports([]);
    }
    return () => {
      active = false;
    };
  }, [factoryId, currentUser]);

  if (loading && !detail) {
    return <div className="p-4 text-xs text-slate-500">Loading factory details…</div>;
  }

  if (error && !detail) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D]"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" /> Back
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
      </div>
    );
  }

  if (!detail) return null;

  const tabs: Array<{ id: FactoryDetailTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "machines", label: "Machines" },
    { id: "operators", label: "Operators" },
    { id: "reports", label: "Reports" },
    { id: "maintenance", label: "Maintenance" },
    { id: "handover", label: "Handover" },
  ];

  const openAbnormalities = abnormalities.filter((a) => a.status !== "resolved");

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" />
          Back to Region
        </button>
        <span className="truncate font-mono text-[10px] text-slate-500">
          {detail.region_name} / {detail.code}
        </span>
      </div>

      {/* Factory Header */}
      <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase text-[#2563EB]">
              {detail.region_name} • {detail.facility_type}
            </span>
            <h3 className="mt-0.5 text-base font-bold text-[#14213D]">{detail.name}</h3>
            <div className="mt-1 flex items-center gap-1 text-xs text-[#334155]">
              <MapPin className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>{detail.location_label ?? "India"}</span>
              <span className="font-mono text-[10px] text-slate-500">
                ({detail.latitude?.toFixed(4)}, {detail.longitude?.toFixed(4)})
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate(`/digital-twin/factory/${detail.id}`)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Open Factory Digital Twin
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 6 Section Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
              activeTab === t.id
                ? "bg-[#2563EB] text-white shadow-2xs"
                : "text-[#334155] hover:bg-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center font-mono text-xs">
            <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
              <div className="text-[10px] text-slate-500">Lines</div>
              <div className="text-sm font-bold text-[#14213D]">{detail.production_lines.length}</div>
            </div>
            <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
              <div className="text-[10px] text-slate-500">Machines</div>
              <div className="text-sm font-bold text-[#14213D]">{detail.summary.total_machines}</div>
            </div>
            <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
              <div className="text-[10px] text-slate-500">Factory OEE</div>
              <div className="text-sm font-bold text-[#2563EB]">{detail.summary.overall_oee}%</div>
            </div>
          </div>

          <div className="rounded-xl border border-[#DCE6F2] bg-white p-3 text-xs">
            <h4 className="mb-2 font-bold uppercase tracking-wider text-[#14213D]">Machine Status</h4>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="flex justify-between rounded bg-emerald-50 px-2 py-1 text-emerald-800">
                <span>Running</span>
                <strong>{detail.summary.running_machines}</strong>
              </div>
              <div className="flex justify-between rounded bg-amber-50 px-2 py-1 text-amber-800">
                <span>Idle</span>
                <strong>{detail.summary.idle_machines}</strong>
              </div>
              <div className="flex justify-between rounded bg-red-50 px-2 py-1 text-red-800">
                <span>Fault</span>
                <strong>{detail.summary.faulted_machines}</strong>
              </div>
              <div className="flex justify-between rounded bg-sky-50 px-2 py-1 text-sky-800">
                <span>Maintenance</span>
                <strong>{detail.summary.maintenance_machines}</strong>
              </div>
            </div>
            <div className="mt-2.5 flex justify-between border-t border-[#DCE6F2] pt-2 text-[11px] text-[#334155]">
              <span>Production Output</span>
              <strong className="font-mono text-[#14213D]">
                {detail.summary.total_production} / {detail.summary.total_target} units
              </strong>
            </div>
          </div>

          <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Open Abnormalities ({openAbnormalities.length})
              </h4>
            </div>
            {openAbnormalities.length === 0 ? (
              <p className="text-xs text-slate-500">No open abnormalities in this factory.</p>
            ) : (
              <div className="space-y-1.5">
                {openAbnormalities.slice(0, 5).map((abn) => (
                  <button
                    key={abn.id}
                    type="button"
                    onClick={() => onSelectMachine(abn.machine_id)}
                    className="w-full rounded-lg border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-left text-xs hover:border-amber-400"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#14213D]">{abn.code} — {abn.title}</span>
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-800">
                        {abn.severity}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "machines" && (
        <div className="space-y-3">
          {detail.production_lines.map((line) => (
            <div key={line.id} className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] font-bold text-[#2563EB]">{line.code}</span>
                  <h4 className="text-xs font-bold text-[#14213D]">{line.name}</h4>
                </div>
                <span className="font-mono text-[11px] text-slate-500">
                  {line.machines.length} machines • {line.summary.overall_oee}% OEE
                </span>
              </div>
              <div className="space-y-1.5">
                {line.machines.map((m) => {
                  const st = liveStates[m.id] ?? m.state;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectMachine(m.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 px-2.5 py-2 text-left text-xs transition hover:border-[#2563EB] hover:bg-[#EAF2FC]"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[#14213D]">
                          <span className="mr-1.5 font-mono text-[#2563EB]">{m.code}</span>
                          {m.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {m.machine_type} • OEE {st?.oee_pct ?? 0}%
                        </div>
                      </div>
                      <StatusBadge status={(st?.status as "Running") ?? "Unknown"} size="sm" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "operators" && (
        <OperatorProfilePanel
          hierarchy={hierarchy}
          lockedFactoryId={factoryId}
          selectedUserId={selectedUserId}
          onSelectUser={onSelectUser}
          onSelectMachine={(machineId) => onSelectMachine(machineId)}
        />
      )}

      {activeTab === "reports" && (
        <div className="space-y-2.5">
          {!currentUser ? (
            <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-4 text-center text-xs">
              <p className="text-[#334155]">Sign in to browse and download authorized factory reports.</p>
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#2563EB] px-3 py-1.5 font-semibold text-white"
              >
                <LogIn className="h-3.5 w-3.5" /> Sign In
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#14213D]">
                  Factory Reports ({reports.length})
                </span>
                {currentUser && ["company_admin", "regional_manager"].includes(currentUser.role) && (
                  <Link
                    to={`/digital-twin/reports?factory_id=${factoryId}`}
                    className="text-xs font-semibold text-[#2563EB] hover:underline"
                  >
                    Open Centralized Reports →
                  </Link>
                )}
              </div>
              {reports.length === 0 ? (
                <p className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-3 text-xs text-slate-500">
                  No reports recorded for this factory yet.
                </p>
              ) : (
                reports.map((rep) => (
                  <div
                    key={rep.report_uid}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[#DCE6F2] bg-white p-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[#14213D]">{rep.title}</div>
                      <div className="text-[11px] text-slate-500">
                        {rep.category_label} • {rep.machine_code} • {rep.shift_name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        digitalTwinApi.downloadFile(
                          `/api/ps032/reports/download/${encodeURIComponent(rep.report_uid)}`,
                          `${rep.report_uid}.pdf`
                        )
                      }
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#DCE6F2] px-2 py-1 text-[11px] font-semibold text-[#2563EB] hover:bg-[#EAF2FC]"
                    >
                      <Download className="h-3 w-3" /> PDF
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "maintenance" && (
        <div className="space-y-3">
          {maintSchedules.length > 0 && (
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                Preventive Schedules ({maintSchedules.length})
              </h4>
              <div className="space-y-1.5">
                {maintSchedules.slice(0, 6).map((s) => (
                  <div key={s.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#14213D]">{s.title}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          s.is_overdue ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {s.is_overdue ? "OVERDUE" : s.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Due: {new Date(s.due_date).toLocaleDateString()} • {s.machine_id}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
              <Wrench className="h-3.5 w-3.5 text-[#2563EB]" />
              Maintenance Records ({maintRecords.length})
            </h4>
            {maintRecords.length === 0 ? (
              <p className="text-xs text-slate-500">No maintenance records found.</p>
            ) : (
              <div className="space-y-1.5">
                {maintRecords.slice(0, 8).map((r) => (
                  <div key={r.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#14213D]">{r.summary}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                        {r.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {r.machine_id} • {r.maintenance_type} • {r.engineer_name ?? "Engineer"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "handover" && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
            <ClipboardCheck className="h-3.5 w-3.5 text-[#2563EB]" />
            Shift Handover Reports ({handovers.length})
          </h4>
          {handovers.length === 0 ? (
            <p className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-3 text-xs text-slate-500">
              No shift handover reports recorded for this factory.
            </p>
          ) : (
            handovers.slice(0, 10).map((ho) => (
              <div key={ho.id} className="rounded-xl border border-[#DCE6F2] bg-white p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[#14213D]">{ho.id}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      ho.status === "acknowledged"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {ho.status}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-[#334155]">
                  {ho.previous_shift_name} → {ho.incoming_shift_name}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Machine: {ho.machine_id} • Outgoing: {ho.outgoing_operator ?? "—"} • Prod:{" "}
                  {ho.production_completed}/{ho.production_target}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

interface MachineDetailPanelProps {
  machineId: string;
  liveStates: Record<string, { status: string; oee_pct?: number; temperature_c?: number | null; vibration_mm_s?: number | null; energy_kw?: number | null; cycle_time_sec?: number | null; production_count?: number; production_target?: number; assigned_operator?: string | null }>;
  onBack: () => void;
  onSelectOperator: (userId: number) => void;
}

export const MachineDetailPanel: React.FC<MachineDetailPanelProps> = ({
  machineId,
  liveStates,
  onBack,
  onSelectOperator,
}) => {
  const navigate = useNavigate();
  const { currentUser } = useTwinStore();

  const [detail, setDetail] = useState<MachineDetail | null>(null);
  const [workspace, setWorkspace] = useState<MachineWorkspace | null>(null);
  const [assignedPersonnel, setAssignedPersonnel] = useState<PersonnelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    digitalTwinApi
      .getMachineDetail(machineId)
      .then((res) => {
        if (active) setDetail(res);
      })
      .catch((err) => {
        if (active) setError((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    if (currentUser) {
      digitalTwinApi
        .getMachineWorkspace(machineId)
        .then((ws) => {
          if (active) setWorkspace(ws);
        })
        .catch(() => {});

      digitalTwinApi
        .listPersonnel({ machine_id: machineId })
        .then((users) => {
          if (active) setAssignedPersonnel(users);
        })
        .catch(() => {});
    } else {
      setWorkspace(null);
      setAssignedPersonnel([]);
    }

    return () => {
      active = false;
    };
  }, [machineId, currentUser]);

  if (loading && !detail) {
    return <div className="p-4 text-xs text-slate-500">Loading machine details…</div>;
  }

  if (error && !detail) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D]"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" /> Back
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
      </div>
    );
  }

  if (!detail) return null;

  const live = liveStates[detail.id] ?? detail.state;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" />
          Back to Factory
        </button>
        <span className="truncate font-mono text-[10px] text-slate-500">
          {detail.factory_name} / {detail.line_name} / {detail.code}
        </span>
      </div>

      {/* Machine Identity */}
      <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase text-[#2563EB]">
              Asset ID: {detail.code} • {detail.machine_type}
            </span>
            <h3 className="mt-0.5 text-base font-bold text-[#14213D]">{detail.name}</h3>
            <p className="mt-0.5 text-[11px] text-[#334155]">
              {detail.factory_name} • {detail.line_name}
            </p>
          </div>
          <StatusBadge status={(live?.status as "Running") ?? "Unknown"} />
        </div>

        <button
          type="button"
          onClick={() => navigate(`/digital-twin/machine/${detail.id}`)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Open 3D Digital Twin View
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Live Telemetry & Sensor Readings */}
      <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
          <Activity className="h-3.5 w-3.5 text-[#2563EB]" />
          Telemetry & Sensor Readings
        </h4>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 p-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Gauge className="h-3 w-3 text-[#2563EB]" /> OEE
            </div>
            <div className="font-bold text-[#14213D]">{live?.oee_pct ?? detail.state?.oee_pct ?? 0}%</div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 p-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Thermometer className="h-3 w-3 text-[#2563EB]" /> Temp
            </div>
            <div className="font-bold text-[#14213D]">
              {live?.temperature_c ?? detail.state?.temperature_c ?? "—"} °C
            </div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 p-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Activity className="h-3 w-3 text-[#2563EB]" /> Vibration
            </div>
            <div className="font-bold text-[#14213D]">
              {live?.vibration_mm_s ?? detail.state?.vibration_mm_s ?? "—"} mm/s
            </div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 p-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Zap className="h-3 w-3 text-[#2563EB]" /> Energy
            </div>
            <div className="font-bold text-[#14213D]">
              {live?.energy_kw ?? detail.state?.energy_kw ?? "—"} kW
            </div>
          </div>
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-slate-500">
          <span>Production Output</span>
          <strong className="font-mono text-[#14213D]">
            {live?.production_count ?? detail.state?.production_count ?? 0} /{" "}
            {live?.production_target ?? detail.state?.production_target ?? 0} units
          </strong>
        </div>
      </div>

      {/* Assigned Operator */}
      <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
          <UserIcon className="h-3.5 w-3.5 text-[#2563EB]" />
          Assigned Operator(s)
        </h4>
        {assignedPersonnel.length > 0 ? (
          <div className="space-y-1.5">
            {assignedPersonnel.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => onSelectOperator(person.id)}
                className="flex w-full items-center justify-between rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/70 px-2.5 py-2 text-left text-xs transition hover:border-[#2563EB] hover:bg-[#EAF2FC]"
              >
                <div>
                  <div className="font-bold text-[#14213D]">{person.name}</div>
                  <div className="text-[11px] text-slate-600">
                    {person.employee_id ?? person.role}
                    {person.current_shift ? ` • ${person.current_shift}` : ""}
                  </div>
                </div>
                <span className="text-[11px] font-semibold text-[#2563EB]">View Profile →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[#334155]">
            {live?.assigned_operator ?? detail.state?.assigned_operator ?? "Unassigned"}
          </div>
        )}
      </div>

      {/* Production History */}
      {workspace && (
        <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
            <FileText className="h-3.5 w-3.5 text-[#2563EB]" />
            Recent Production ({workspace.production_entries.length})
          </h4>
          {workspace.production_entries.length === 0 ? (
            <p className="text-xs text-slate-500">No production entries recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {workspace.production_entries.slice(0, 5).map((p) => (
                <div key={p.id} className="flex justify-between rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                  <div>
                    <div className="font-semibold text-[#14213D]">{p.shift_name}</div>
                    <div className="text-[10px] text-slate-500">{p.operator_name ?? "Operator"}</div>
                  </div>
                  <div className="text-right font-mono">
                    <strong>{p.units_produced}/{p.target_units}</strong>
                    <div className="text-[10px] text-slate-500">{p.reject_units} rej</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Abnormalities */}
      {workspace && (
        <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            Abnormalities ({workspace.abnormalities.length})
          </h4>
          {workspace.abnormalities.length === 0 ? (
            <p className="text-xs text-slate-500">No abnormalities recorded for this machine.</p>
          ) : (
            <div className="space-y-1.5">
              {workspace.abnormalities.slice(0, 5).map((a) => (
                <div key={a.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-[#14213D]">{a.code} — {a.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">{a.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Maintenance History */}
      {workspace && (
        <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
            <Wrench className="h-3.5 w-3.5 text-[#2563EB]" />
            Maintenance History ({workspace.maintenance_records.length})
          </h4>
          {workspace.maintenance_records.length === 0 ? (
            <p className="text-xs text-slate-500">No maintenance records found.</p>
          ) : (
            <div className="space-y-1.5">
              {workspace.maintenance_records.slice(0, 5).map((m) => (
                <div key={m.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-[#14213D]">{m.summary}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">{m.status}</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {m.maintenance_type} • {m.engineer_name ?? "Engineer"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quick link hint if unauthenticated */}
      {!currentUser && (
        <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3 text-xs text-[#334155]">
          Sign in to inspect full abnormalities, maintenance history, and production reports for {detail.code}.
        </div>
      )}
    </div>
  );
};
