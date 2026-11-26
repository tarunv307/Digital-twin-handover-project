import React from "react";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { MachineSummary, OperationalSummary } from "../../types/digitalTwin";
import { useTwinStore } from "../../store/twinStore";

export const SummaryStrip: React.FC<{ summary: OperationalSummary }> = ({ summary }) => {
  const items = [
    { label: "Factories", value: summary.total_factories },
    { label: "Machines", value: summary.total_machines },
    { label: "Running", value: summary.running_machines, cls: "text-emerald-700" },
    { label: "Idle", value: summary.idle_machines, cls: "text-amber-700" },
    { label: "Faults", value: summary.faulted_machines, cls: "text-red-700" },
    { label: "Maint.", value: summary.maintenance_machines, cls: "text-sky-700" },
    { label: "Production", value: `${summary.total_production}/${summary.total_target}` },
    { label: "OEE", value: `${summary.overall_oee}%`, cls: "text-blue-700" },
    { label: "Pending Handovers", value: summary.pending_handovers, cls: summary.pending_handovers > 0 ? "text-amber-700" : "" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
      {items.map((item) => (
        <div key={item.label} className="rounded border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{item.label}</div>
          <div className={`font-mono text-sm font-bold tabular-nums ${item.cls ?? "text-slate-900"}`}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
};

interface OverviewFallbackProps {
  title: string;
  items: Array<{
    id: string;
    code: string;
    name: string;
    subtitle: string;
    metrics: string;
    status?: string;
    onOpen: () => void;
  }>;
}

export const OverviewFallback: React.FC<OverviewFallbackProps> = ({ title, items }) => {
  return (
    <div className="h-full overflow-y-auto bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-600">{title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={it.onOpen}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-600 hover:shadow"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-blue-700">{it.code}</span>
                  {it.status && <StatusBadge status={it.status} size="sm" />}
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">{it.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{it.subtitle}</div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 font-mono text-xs text-slate-700">
                <span>{it.metrics}</span>
                <ArrowRight className="h-3.5 w-3.5 text-blue-700" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const MachineSequenceList: React.FC<{
  machines: MachineSummary[];
  onSelect: (id: string) => void;
}> = ({ machines, onSelect }) => {
  const { liveStates } = useTwinStore();
  return (
    <div className="h-full overflow-y-auto bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-2.5">
        {machines.map((m) => {
          const st = liveStates[m.id] ?? m.state;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-600"
            >
              <div className="flex items-center gap-3">
                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700">
                  #{String(m.sequence_order).padStart(2, "0")}
                </span>
                <div>
                  <div className="text-sm font-bold text-slate-900">{m.name}</div>
                  <div className="font-mono text-xs text-slate-500">{m.code} • {m.machine_type}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-xs text-slate-700">OEE {st?.oee_pct ?? 0}%</span>
                <StatusBadge status={st?.status} size="sm" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

