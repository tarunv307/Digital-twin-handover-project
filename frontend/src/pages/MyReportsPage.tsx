import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, LogIn, RefreshCw, ShieldAlert } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { MyReportsResponse } from "../types/digitalTwin";

type TabKey = "production" | "abnormalities" | "safety" | "quality" | "downtime" | "handovers";

export const MyReportsPage: React.FC = () => {
  const { currentUser, setAuthModalOpen } = useTwinStore();
  const [data, setData] = useState<MyReportsResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("production");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await digitalTwinApi.getMyReports();
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Company", to: "/digital-twin" },
        { label: "My Machines", to: "/digital-twin/operator" },
        { label: "My Reports" },
      ]}
      title="My Operational Submissions & Shift History"
      subtitle={currentUser ? `Scoped records for ${currentUser.name} (${currentUser.role})` : "Sign in required"}
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
            <h2 className="mt-3 text-sm font-bold text-slate-900">Sign In Required</h2>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              <LogIn className="h-4 w-4" /> Sign In
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-4">
            {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

            <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-2">
              {[
                { id: "production" as TabKey, label: `Production (${data?.production_entries.length ?? 0})` },
                { id: "abnormalities" as TabKey, label: `Abnormalities (${data?.abnormalities.length ?? 0})` },
                { id: "safety" as TabKey, label: `Safety Checklists (${data?.safety_checklists.length ?? 0})` },
                { id: "quality" as TabKey, label: `Quality Checks (${data?.quality_inspections.length ?? 0})` },
                { id: "downtime" as TabKey, label: `Downtime (${data?.downtime_events.length ?? 0})` },
                { id: "handovers" as TabKey, label: `Handovers (${data?.handovers.length ?? 0})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                    tab === t.id ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {loading || !data ? (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                Loading reports…
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white shadow-xs">
                {tab === "production" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">Machine</th>
                          <th className="px-4 py-2.5">Shift</th>
                          <th className="px-4 py-2.5">Actual / Target</th>
                          <th className="px-4 py-2.5">Good / Rejects</th>
                          <th className="px-4 py-2.5">Recorded At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.production_entries.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                              No production entries recorded under your account yet.
                            </td>
                          </tr>
                        )}
                        {data.production_entries.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">
                              <Link to={`/digital-twin/machine/${p.machine_id}`}>{p.machine_id}</Link>
                            </td>
                            <td className="px-4 py-2.5">{p.shift_name}</td>
                            <td className="px-4 py-2.5 font-mono">
                              {p.units_produced} / {p.target_units} pcs
                            </td>
                            <td className="px-4 py-2.5 font-mono">
                              {p.good_units} good / {p.reject_units} rej
                            </td>
                            <td className="px-4 py-2.5 text-slate-500">{new Date(p.recorded_at).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "abnormalities" && (
                  <div className="divide-y divide-slate-100 p-4">
                    {data.abnormalities.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">No abnormalities recorded in scope.</div>
                    ) : (
                      data.abnormalities.map((a) => (
                        <div key={a.id} className="flex items-center justify-between py-2.5 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">{a.code}</span>
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">{a.severity}</span>
                              <span className="font-semibold text-slate-800">{a.title}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Machine: {a.machine_id} • Reported by {a.reported_by_name ?? "Operator"} •{" "}
                              {new Date(a.created_at).toLocaleString()}
                            </div>
                          </div>
                          <span className="rounded border border-slate-200 px-2 py-0.5 font-mono text-[11px]">{a.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {tab === "safety" && (
                  <div className="divide-y divide-slate-100 p-4">
                    {data.safety_checklists.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">No safety checklists submitted yet.</div>
                    ) : (
                      data.safety_checklists.map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-2.5 text-xs">
                          <div>
                            <div className="font-semibold text-slate-900">
                              <ClipboardList className="mr-1.5 inline h-3.5 w-3.5 text-blue-700" />
                              {s.machine_id} — {s.shift_name} ({s.items_json.length} checks)
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              By {s.submitted_by_name} • Review: {s.supervisor_review_status}
                              {s.escalated_abnormality_id ? ` • Escalated Abnormality #${s.escalated_abnormality_id}` : ""}
                            </div>
                          </div>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${
                              s.has_critical_failure ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {s.overall_status}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {tab === "quality" && (
                  <div className="divide-y divide-slate-100 p-4">
                    {data.quality_inspections.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">No quality inspections logged yet.</div>
                    ) : (
                      data.quality_inspections.map((q) => (
                        <div key={q.id} className="flex items-center justify-between py-2.5 text-xs">
                          <div>
                            <div className="font-semibold text-slate-900">
                              {q.machine_id} • Category: <span className="uppercase">{q.defect_category}</span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Inspected: {q.inspected_qty} • Rejected: {q.rejected_qty} • Reworked: {q.reworked_qty} • By{" "}
                              {q.inspector_name}
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-400">{new Date(q.inspected_at).toLocaleString()}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {tab === "downtime" && (
                  <div className="divide-y divide-slate-100 p-4">
                    {data.downtime_events.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">No downtime events logged.</div>
                    ) : (
                      data.downtime_events.map((d) => (
                        <div key={d.id} className="flex items-center justify-between py-2.5 text-xs">
                          <div>
                            <div className="font-semibold text-slate-900">
                              {d.machine_id} • {d.category.toUpperCase()} ({d.reason_category})
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-600">{d.reason_detail}</div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-bold text-slate-900">{d.duration_minutes} min</div>
                            <div className="text-[10px] uppercase text-slate-500">{d.status}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {tab === "handovers" && (
                  <div className="divide-y divide-slate-100 p-4">
                    {data.handovers.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">No shift handovers in scope.</div>
                    ) : (
                      data.handovers.map((h) => (
                        <div key={h.id} className="flex items-center justify-between py-2.5 text-xs">
                          <div>
                            <Link
                              to={`/digital-twin/machine/${h.machine_id}/handover`}
                              className="font-mono font-bold text-blue-700 hover:underline"
                            >
                              {h.id}
                            </Link>
                            <div className="text-[11px] text-slate-500">
                              {h.machine_id} • {h.previous_shift_name} → {h.incoming_shift_name} • Outgoing:{" "}
                              {h.outgoing_operator ?? "—"}
                            </div>
                          </div>
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${
                              h.status === "acknowledged" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {h.status}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};
