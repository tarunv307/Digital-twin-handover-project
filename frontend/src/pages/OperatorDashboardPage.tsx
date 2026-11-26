import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  ClipboardList,
  LogIn,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { StatusBadge } from "../components/ui/StatusBadge";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { MyMachineItem } from "../types/digitalTwin";

export const OperatorDashboardPage: React.FC = () => {
  const { currentUser, liveStates, setAuthModalOpen, structuralVersion } = useTwinStore();
  const [machines, setMachines] = useState<MyMachineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) {
      setMachines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await digitalTwinApi.getMyMachines();
      setMachines(res.machines);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentUser, structuralVersion]);

  useEffect(() => {
    load();
  }, [load]);

  const enrichedMachines = machines.map((m) => ({
    ...m,
    liveState: liveStates[m.id] ?? m.state,
  }));

  const pendingHandoversCount = enrichedMachines.filter((m) => m.has_pending_handover).length;
  const faultCount = enrichedMachines.filter((m) => m.liveState?.status === "Fault").length;

  return (
    <AppShell
      breadcrumbs={[
        { label: "Company", to: "/digital-twin" },
        { label: "My Assigned Machines" },
      ]}
      title="Operator & Technician Assigned Workbench"
      subtitle={
        currentUser
          ? `${currentUser.name} • Role: ${currentUser.role} • Showing strictly authorized machines`
          : "Sign in to view your assigned machines and shift actions"
      }
      showOverviewToggle={false}
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/digital-twin/my-reports"
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            My Reports
          </Link>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      }
    >
      <div className="h-full overflow-y-auto p-5">
        {!currentUser ? (
          <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-10 w-10 text-blue-700" />
            <h2 className="mt-3 text-base font-bold text-slate-900">Authentication Required</h2>
            <p className="mt-1 text-xs text-slate-600">
              Machine access is strictly scoped by operator/engineer assignment. Sign in with your station account to
              open your assigned machines.
            </p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-5">
            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
            )}

            {/* KPI Summary Strip */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Assigned Machines
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{enrichedMachines.length}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">Scoped by active backend assignments</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Pending Handover Sign-offs
                </div>
                <div
                  className={`mt-1 font-mono text-2xl font-bold ${
                    pendingHandoversCount > 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {pendingHandoversCount}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">Incoming operator confirmation required</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Active Machine Faults
                </div>
                <div
                  className={`mt-1 font-mono text-2xl font-bold ${
                    faultCount > 0 ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  {faultCount}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">Requiring inspection / abnormality log</div>
              </div>
            </div>

            {loading ? (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                Loading assigned machines…
              </div>
            ) : enrichedMachines.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-xs text-amber-900">
                No active machine assignments found for <strong>{currentUser.name}</strong>. Ask your Factory Supervisor
                or Company Admin to assign a machine & shift in <strong>Users & Access</strong>.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {enrichedMachines.map((m) => {
                  const st = m.liveState;
                  const healthTone =
                    m.health_score >= 85
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : m.health_score >= 65
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : "bg-red-50 text-red-800 border-red-200";
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-xs transition hover:border-blue-300"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-blue-700">{m.code}</span>
                              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${healthTone}`}>
                                Est. Health {m.health_score} ({m.health_category})
                              </span>
                            </div>
                            <h3 className="mt-1 text-sm font-bold text-slate-900">{m.name}</h3>
                            <p className="text-[11px] text-slate-500">
                              {m.factory_name} • {m.line_name}
                            </p>
                          </div>
                          {st && <StatusBadge status={st.status} size="sm" />}
                        </div>

                        {m.has_pending_handover && (
                          <div className="mt-2.5 flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-900">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                            Pending Shift Handover Awaiting Review
                          </div>
                        )}

                        <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-slate-50 p-2.5 text-[11px]">
                          <div>
                            <span className="text-slate-500">Assigned Shift</span>
                            <div className="font-semibold text-slate-800">{m.assigned_shift ?? "Active Shift"}</div>
                          </div>
                          <div>
                            <span className="text-slate-500">OEE</span>
                            <div className="font-mono font-bold text-slate-900">{st?.oee_pct ?? 0}%</div>
                          </div>
                          <div>
                            <span className="text-slate-500">Production</span>
                            <div className="font-mono font-semibold text-slate-800">
                              {st?.production_count ?? 0} / {st?.production_target ?? 0} pcs
                            </div>
                          </div>
                          <div>
                            <span className="text-slate-500">Temp / Power</span>
                            <div className="font-mono font-semibold text-slate-800">
                              {st?.temperature_c ?? "—"}°C • {st?.energy_kw ?? "—"} kW
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                        <Link
                          to={`/digital-twin/machine/${m.id}`}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Workspace
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                        <Link
                          to={`/digital-twin/machine/${m.id}/handover`}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          Handover
                        </Link>
                        <Link
                          to={`/digital-twin/qr/${m.qr_token}`}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          title="QR Machine Passport"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-700" />
                <span>
                  Backend authorization enforces strict machine & shift scope across URLs, QR scans, and API writes.
                </span>
              </div>
              <Link to="/digital-twin" className="font-semibold text-blue-700 hover:underline">
                View Permitted Hierarchy
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
