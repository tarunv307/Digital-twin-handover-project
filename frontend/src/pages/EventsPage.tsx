import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { StatusBadge } from "../components/ui/StatusBadge";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { AuditEvent, MachineEvent, ShiftTransitionLogItem } from "../types/digitalTwin";

export const EventsPage: React.FC = () => {
  const navigate = useNavigate();
  const { liveEvents, structuralVersion } = useTwinStore();
  const [events, setEvents] = useState<MachineEvent[]>([]);
  const [transitions, setTransitions] = useState<ShiftTransitionLogItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEvent[]>([]);
  const [severityFilter, setSeverityFilter] = useState<string>("");

  const load = useCallback(async () => {
    const [evs, trs, audits] = await Promise.all([
      digitalTwinApi.getEvents({ severity: severityFilter || undefined, limit: 80 }),
      digitalTwinApi.getShiftTransitions(),
      digitalTwinApi.getAuditTrail({ limit: 80 }),
    ]);
    setEvents(evs);
    setTransitions(trs);
    setAuditLogs(audits);
  }, [severityFilter]);

  useEffect(() => {
    load();
  }, [load, liveEvents.length, structuralVersion]);

  const severityBadge = (sev: string) => {
    if (sev === "critical") return "bg-red-50 text-red-700 border-red-200";
    if (sev === "warning") return "bg-amber-50 text-amber-800 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  return (
    <AppShell
      breadcrumbs={[{ label: "Events & Audit Trail" }]}
      title="Machine Events, Shift Transitions & Audit Trail"
      subtitle="Synchronized telemetry events and immutable PS-032 compliance log"
      showOverviewToggle={false}
      actions={
        <div className="flex items-center gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      }
    >
      <div className="h-full overflow-y-auto bg-slate-100 p-5">
        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-12">
          {/* Machine Events */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-6">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Machine Event Timeline ({events.length})
              </h2>
            </div>
            <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityBadge(ev.severity)}`}>
                        {ev.severity}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/digital-twin/machine/${ev.machine_id}`)}
                        className="font-mono font-bold text-blue-700 hover:underline"
                      >
                        {ev.machine_id}
                      </button>
                      {ev.new_status && <StatusBadge status={ev.new_status} size="sm" />}
                    </div>
                    <p className="mt-1 text-slate-800">{ev.message}</p>
                  </div>
                  <div className="text-right font-mono text-[11px] text-slate-500">
                    <div>{new Date(ev.timestamp).toLocaleTimeString()}</div>
                    <div>{ev.shift_name ?? "—"}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Immutable PS-032 Audit Trail */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-6">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <ShieldCheck className="h-4 w-4 text-blue-700" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                PS-032 Immutable Audit Trail ({auditLogs.length})
              </h2>
            </div>
            <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
              {auditLogs.map((a) => (
                <div key={a.id} className="px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-800">
                        {a.action}
                      </span>
                      <span className="font-semibold text-slate-900">{a.actor_name ?? "System"}</span>
                      <span className="font-mono text-[10px] text-slate-400">({a.actor_role ?? "system"})</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-700">{a.details}</p>
                  {a.machine_id && (
                    <button
                      type="button"
                      onClick={() => navigate(`/digital-twin/machine/${a.machine_id}`)}
                      className="mt-1 font-mono text-[10px] font-semibold text-blue-700 hover:underline"
                    >
                      Machine: {a.machine_id}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Shift Transitions */}
          {transitions.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-12">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                Regional Shift Transitions ({transitions.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {transitions.map((t) => (
                  <div key={t.id} className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
                    <div className="font-semibold text-slate-900">
                      {t.previous_shift_name} → {t.new_shift_name}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {t.region_id} ({t.timezone})
                    </div>
                    <div className="mt-1 text-[11px] text-amber-700">
                      {t.machines_flagged_pending} machines flagged pending
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};
