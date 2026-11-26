import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  LogIn,
  RefreshCw,
  ShieldAlert,
  Wrench,
  Zap,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type {
  CompanyOverview,
  FactoryAnalyticsResponse,
  MaintenanceSchedule,
  ShiftRosterResponse,
} from "../types/digitalTwin";

export const AnalyticsPage: React.FC = () => {
  const { currentUser, setAuthModalOpen } = useTwinStore();
  const [company, setCompany] = useState<CompanyOverview | null>(null);
  const [analytics, setAnalytics] = useState<FactoryAnalyticsResponse | null>(null);
  const [roster, setRoster] = useState<ShiftRosterResponse | null>(null);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);

  const [regionId, setRegionId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [shiftName, setShiftName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [comp, ana, ros, pms] = await Promise.all([
        digitalTwinApi.getCompanyOverview(),
        digitalTwinApi.getFactoryAnalytics({
          region_id: regionId || undefined,
          factory_id: factoryId || undefined,
          shift_name: shiftName || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
        digitalTwinApi.getShiftRoster({
          region_id: regionId || undefined,
          factory_id: factoryId || undefined,
        }),
        digitalTwinApi.listMaintenanceSchedules(),
      ]);
      setCompany(comp);
      setAnalytics(ana);
      setRoster(ros);
      setSchedules(pms);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentUser, regionId, factoryId, shiftName, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const factories =
    company?.regions
      .filter((r) => !regionId || r.id === regionId)
      .flatMap((r) => r.factories) ?? [];

  return (
    <AppShell
      breadcrumbs={[
        { label: "Company", to: "/digital-twin" },
        { label: "Factory Performance Analytics" },
      ]}
      title="PS-032 Factory Performance, Shift Roster & Loss Analytics"
      subtitle="Aggregated live OEE, Target vs Actual, Downtime Loss, PM Alerts, Health & Energy KPIs"
      showOverviewToggle={false}
      actions={
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      <div className="h-full overflow-y-auto p-5">
        {!currentUser ? (
          <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
            <ShieldAlert className="mx-auto h-9 w-9 text-blue-700" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">Sign In to View Analytics</h2>
            <p className="mt-1 text-xs text-slate-500">Analytics strictly honors your role and factory/machine scope.</p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              <LogIn className="h-4 w-4" /> Sign In
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-5">
            {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

            {/* Filters Bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
              <select
                value={regionId}
                onChange={(e) => {
                  setRegionId(e.target.value);
                  setFactoryId("");
                }}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">All Permitted Regions</option>
                {company?.regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select
                value={factoryId}
                onChange={(e) => setFactoryId(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">All Permitted Factories</option>
                {factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                value={shiftName}
                onChange={(e) => setShiftName(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">All Shifts</option>
                <option value="Morning Shift">Morning Shift</option>
                <option value="Evening Shift">Evening Shift</option>
                <option value="Night Shift">Night Shift</option>
              </select>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  setRegionId("");
                  setFactoryId("");
                  setShiftName("");
                  setStartDate("");
                  setEndDate("");
                }}
                className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Reset Filters
              </button>
            </div>

            {loading || !analytics ? (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                Aggregating plant metrics…
              </div>
            ) : (
              <>
                {/* Top KPIs */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Overall OEE</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-blue-700">{analytics.kpis.overall_oee}%</div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                      A {analytics.kpis.availability_pct}% • P {analytics.kpis.performance_pct}% • Q{" "}
                      {analytics.kpis.quality_pct}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Target Achievement</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-emerald-700">
                      {analytics.kpis.target_achievement_pct}%
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                      {analytics.kpis.total_actual_production} / {analytics.kpis.total_target_production} pcs
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Downtime Loss</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                      {analytics.kpis.total_downtime_min}m
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                      Planned {analytics.kpis.planned_downtime_min}m • Unplan {analytics.kpis.unplanned_downtime_min}m
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Avg Health (Est.)</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                      {analytics.kpis.avg_machine_health_score}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{analytics.scope.machines_count} machine(s)</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">Pending Handovers</div>
                    <div
                      className={`mt-1 font-mono text-2xl font-bold ${
                        analytics.kpis.pending_handovers > 0 ? "text-amber-700" : "text-emerald-700"
                      }`}
                    >
                      {analytics.kpis.pending_handovers}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">Shift sign-offs open</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">PM Overdue / Load</div>
                    <div
                      className={`mt-1 font-mono text-2xl font-bold ${
                        analytics.kpis.maintenance_overdue_count > 0 ? "text-red-700" : "text-slate-900"
                      }`}
                    >
                      {analytics.kpis.maintenance_overdue_count} overdue
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                      <Zap className="mr-0.5 inline h-3 w-3" /> {analytics.kpis.total_power_kw} kW
                    </div>
                  </div>
                </div>

                {/* Line-Wise & Shift-Wise Production */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="mb-3 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-blue-700" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Line-Wise Production Comparison
                      </h3>
                    </div>
                    <div className="space-y-2.5 text-xs">
                      {analytics.line_comparison.map((l) => (
                        <div key={l.line_id} className="rounded border border-slate-100 bg-slate-50 p-2.5">
                          <div className="flex items-center justify-between font-semibold">
                            <span>
                              {l.line_code} — {l.line_name}
                            </span>
                            <span className="font-mono text-blue-700">
                              {l.actual}/{l.target} ({l.achievement_pct}%) • OEE {l.avg_oee}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-blue-600"
                              style={{ width: `${Math.min(100, l.achievement_pct)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-emerald-700" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Shift-Wise Production Target vs Actual
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                          <tr>
                            <th className="px-2.5 py-2">Shift</th>
                            <th className="px-2.5 py-2">Actual / Target</th>
                            <th className="px-2.5 py-2">Good / Reject</th>
                            <th className="px-2.5 py-2">Achiev. %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {analytics.shift_production_summary.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-2.5 py-4 text-center text-slate-400">
                                No shift production entries in filter range.
                              </td>
                            </tr>
                          ) : (
                            analytics.shift_production_summary.map((s) => (
                              <tr key={s.shift_name}>
                                <td className="px-2.5 py-2 font-semibold">{s.shift_name}</td>
                                <td className="px-2.5 py-2 font-mono">
                                  {s.actual} / {s.target}
                                </td>
                                <td className="px-2.5 py-2 font-mono">
                                  {s.good} / {s.rejects}
                                </td>
                                <td className="px-2.5 py-2 font-mono font-bold text-blue-700">{s.achievement_pct}%</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Downtime Causes, Quality Defects, Health Dist */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-800">
                      Top Downtime Causes
                    </h3>
                    {analytics.top_downtime_causes.length === 0 ? (
                      <div className="text-xs text-slate-400">Zero downtime logged.</div>
                    ) : (
                      <div className="space-y-2 text-xs">
                        {analytics.top_downtime_causes.map((c) => (
                          <div key={c.reason_category} className="flex justify-between rounded bg-slate-50 px-3 py-2">
                            <span className="font-semibold capitalize">{c.reason_category}</span>
                            <span className="font-mono font-bold text-red-700">{c.duration_minutes} min</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-800">
                      Quality Defects by Category
                    </h3>
                    {analytics.quality_by_category.length === 0 ? (
                      <div className="text-xs text-slate-400">No quality inspections logged in range.</div>
                    ) : (
                      <div className="space-y-2 text-xs">
                        {analytics.quality_by_category.map((q) => (
                          <div key={q.defect_category} className="flex justify-between rounded bg-slate-50 px-3 py-2">
                            <span className="font-semibold capitalize">{q.defect_category}</span>
                            <span className="font-mono">
                              {q.rejected_qty} rej / {q.reworked_qty} rw ({q.inspected_qty} chk)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-800">
                      Health Distribution (Software Estimate)
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(analytics.health_distribution).map(([cat, count]) => (
                        <div key={cat} className="rounded border border-slate-200 bg-slate-50 p-2.5">
                          <div className="text-[11px] text-slate-500">{cat}</div>
                          <div className="font-mono text-lg font-bold text-slate-900">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preventive Maintenance Due & Pending Handover Roster */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="mb-3 flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-sky-700" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Preventive Maintenance Schedules ({schedules.length})
                      </h3>
                    </div>
                    <div className="space-y-2 text-xs">
                      {schedules.map((s) => (
                        <div
                          key={s.id}
                          className={`flex items-center justify-between rounded border p-2.5 ${
                            s.is_overdue ? "border-red-300 bg-red-50" : "border-slate-200 bg-slate-50"
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-slate-900">
                              <Link to={`/digital-twin/machine/${s.machine_id}`} className="text-blue-700 hover:underline">
                                {s.machine_code ?? s.machine_id}
                              </Link>{" "}
                              — {s.title}
                            </div>
                            <div className="text-[11px] text-slate-600">
                              Due: {new Date(s.due_date).toLocaleDateString()} • Every {s.frequency_days}d • Engineer:{" "}
                              {s.assigned_engineer_name ?? "Unassigned"}
                            </div>
                          </div>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                              s.is_overdue
                                ? "bg-red-700 text-white"
                                : s.status === "completed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-sky-100 text-sky-800"
                            }`}
                          >
                            {s.is_overdue ? "OVERDUE" : s.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Pending Shift Handovers ({roster?.pending_handovers.length ?? 0})
                      </h3>
                    </div>
                    <div className="space-y-2 text-xs">
                      {(!roster || roster.pending_handovers.length === 0) ? (
                        <div className="flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="h-4 w-4" /> All visible machine handovers acknowledged!
                        </div>
                      ) : (
                        roster.pending_handovers.map((h) => (
                          <div key={h.id} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 p-2.5">
                            <div>
                              <Link
                                to={`/digital-twin/machine/${h.machine_id}/handover`}
                                className="font-mono font-bold text-blue-700 hover:underline"
                              >
                                {h.id}
                              </Link>
                              <div className="text-[11px] text-slate-700">
                                {h.machine_id} • {h.previous_shift_name} → {h.incoming_shift_name} • Open Abn:{" "}
                                {h.pending_abnormalities_count}
                              </div>
                            </div>
                            <Link
                              to={`/digital-twin/machine/${h.machine_id}/handover`}
                              className="rounded bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-800"
                            >
                              Acknowledge
                            </Link>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};
