import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { StatusBadge } from "../components/ui/StatusBadge";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { CompanyOverview, MachineEvent, MachineSummary } from "../types/digitalTwin";

export const SimulationPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    simulationStatus,
    refreshSimulationStatus,
    liveStates,
    liveEvents,
    lastSyncAt,
    triggerStructuralRefresh,
  } = useTwinStore();

  const [company, setCompany] = useState<CompanyOverview | null>(null);
  const [machines, setMachines] = useState<MachineSummary[]>([]);
  const [recentEvents, setRecentEvents] = useState<MachineEvent[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState("mch-chn-103");
  const [selectedRegionId, setSelectedRegionId] = useState("reg-south-india");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = (msg: string) =>
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 16));

  const loadAll = useCallback(async () => {
    try {
      const [comp, evs] = await Promise.all([
        digitalTwinApi.getCompanyOverview(),
        digitalTwinApi.getEvents({ limit: 15 }),
      ]);
      setCompany(comp);
      setRecentEvents(evs);
      const factories = comp.regions.flatMap((r) => r.factories);
      const facDetails = await Promise.all(factories.map((f) => digitalTwinApi.getFactoryDetail(f.id)));
      const list = facDetails.flatMap((fd) => fd.production_lines.flatMap((l) => l.machines));
      setMachines(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Merge live WebSocket events ahead of initial DB events
  const mergedEvents = React.useMemo(() => {
    const seen = new Set<number>();
    const combined: MachineEvent[] = [];
    for (const ev of [...liveEvents, ...recentEvents]) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        combined.push(ev);
      }
    }
    return combined.slice(0, 12);
  }, [liveEvents, recentEvents]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refreshSimulationStatus();
      await loadAll();
      triggerStructuralRefresh();
      pushLog(label);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const simState = simulationStatus?.state ?? (simulationStatus?.running ? "running" : "stopped");
  const isRunning = simState === "running";
  const isPaused = simState === "paused";
  const isStopped = simState === "stopped";

  const selectedMachine = machines.find((m) => m.id === selectedMachineId);
  const selectedState = liveStates[selectedMachineId] ?? selectedMachine?.state;

  return (
    <AppShell
      breadcrumbs={[{ label: "Simulation Mode" }]}
      title="Digital Twin Simulation Control Center"
      subtitle="Authoritative backend simulation loop broadcasting real-time telemetry across WebSocket & SQLite"
      showOverviewToggle={false}
    >
      <div className="h-full overflow-y-auto bg-slate-100 p-5">
        {error && (
          <div className="mx-auto mb-4 max-w-7xl rounded border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
            {error}
          </div>
        )}

        <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-12">
          {/* Left Column: Lifecycle & Fault Controls + Live Machine Telemetry Table */}
          <div className="space-y-4 lg:col-span-8">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-[11px] font-bold uppercase ${
                        isRunning
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : isPaused
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      Simulation {simState.toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      {simulationStatus?.simulated_machines_count ?? machines.length} Virtual Machines
                    </span>
                  </div>
                  <h2 className="mt-1.5 text-base font-bold text-slate-900">
                    Simulation Lifecycle & Interval Control
                  </h2>
                  <p className="text-xs text-slate-500">
                    Continuously updates temperature, vibration, power, production counts, and OEE in SQLite and pushes
                    live deltas to all 3D views.
                  </p>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-right font-mono text-xs">
                  <div>
                    Ticks: <strong>{simulationStatus?.ticks_emitted ?? 0}</strong>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Last Sync:{" "}
                    {simulationStatus?.last_tick_at
                      ? new Date(simulationStatus.last_tick_at).toLocaleTimeString()
                      : lastSyncAt
                        ? new Date(lastSyncAt).toLocaleTimeString()
                        : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {isStopped && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction("Started simulation loop", () => digitalTwinApi.startSimulation())}
                    className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start Simulation
                  </button>
                )}

                {isRunning && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction("Paused simulation loop", () => digitalTwinApi.pauseSimulation())}
                    className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </button>
                )}

                {isPaused && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction("Resumed simulation loop", () => digitalTwinApi.resumeSimulation())}
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </button>
                )}

                <button
                  type="button"
                  disabled={busy || isStopped}
                  onClick={() => runAction("Stopped simulation loop", () => digitalTwinApi.stopSimulation())}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction("Executed single simulation tick", () => digitalTwinApi.tickSimulation())}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <StepForward className="h-3.5 w-3.5" />
                  Step 1 Tick
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction("Reset all simulated machines to nominal baseline", () => digitalTwinApi.resetSimulation())}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>

                <div className="ml-auto flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Interval:</span>
                  {[1, 2, 5].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() =>
                        runAction(`Set simulation interval to ${sec}s`, () => digitalTwinApi.setSimulationInterval(sec))
                      }
                      className={`rounded border px-2 py-1 font-mono text-[11px] font-semibold ${
                        Math.round(simulationStatus?.interval_sec ?? 2) === sec
                          ? "border-blue-600 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Machine Fault & Recovery Injection */}
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Selected Machine Fault & Recovery Control</h3>
                <StatusBadge status={selectedState?.status} size="sm" />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={selectedMachineId}
                  onChange={(e) => setSelectedMachineId(e.target.value)}
                  className="min-w-[260px] flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                >
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name} ({(liveStates[m.id] ?? m.state)?.status ?? "Unknown"})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => navigate(`/digital-twin/machine/${selectedMachineId}`)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open 3D Inspector
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Triggered fault E-402 on ${selectedMachineId}`, () =>
                      digitalTwinApi.triggerFault(selectedMachineId)
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Trigger Fault (E-402)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Recovered ${selectedMachineId} to Running`, () =>
                      digitalTwinApi.recoverMachine(selectedMachineId)
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Recover to Running
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Set ${selectedMachineId} to Maintenance`, () =>
                      digitalTwinApi.setMachineStatus(selectedMachineId, "Maintenance")
                    )
                  }
                  className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                >
                  Set Maintenance
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Set ${selectedMachineId} to Idle`, () =>
                      digitalTwinApi.setMachineStatus(selectedMachineId, "Idle")
                    )
                  }
                  className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Set Idle
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Set ${selectedMachineId} to Stopped`, () =>
                      digitalTwinApi.setMachineStatus(selectedMachineId, "Stopped")
                    )
                  }
                  className="rounded border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Set Stopped
                </button>
              </div>
            </div>

            {/* Live Simulated Machine Telemetry Matrix */}
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Live Machine Telemetry Stream ({machines.length} Machines)
                </h3>
                <span className="font-mono text-[11px] text-slate-500">
                  Click a row to select • Updates live via WebSocket
                </span>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Machine</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Temp (°C)</th>
                      <th className="px-3 py-2 text-right">Vib (mm/s)</th>
                      <th className="px-3 py-2 text-right">Prod</th>
                      <th className="px-3 py-2 text-right">OEE</th>
                      <th className="px-3 py-2 text-right">Sync</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {machines.map((m) => {
                      const st = liveStates[m.id] ?? m.state;
                      const isSelected = m.id === selectedMachineId;
                      return (
                        <tr
                          key={m.id}
                          onClick={() => setSelectedMachineId(m.id)}
                          className={`cursor-pointer transition ${
                            isSelected ? "bg-blue-50/70" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-3 py-2 font-sans">
                            <span className="font-mono font-bold text-blue-700">{m.code}</span>{" "}
                            <span className="text-slate-700">{m.name}</span>
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={st?.status} size="sm" />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{st?.temperature_c ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{st?.vibration_mm_s ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {st?.production_count ?? 0}/{st?.production_target ?? 0}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{st?.oee_pct ?? 0}%</td>
                          <td className="px-3 py-2 text-right text-[10px] text-slate-500">
                            {st?.last_sync_at ? new Date(st.last_sync_at).toLocaleTimeString() : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Column: Regional Shift Transition + Recent Simulation Events + Action Log */}
          <div className="space-y-4 lg:col-span-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Regional Shift Transition</h3>
              <p className="mt-1 text-xs text-slate-500">
                Closes the active regional shift and flags machines handover-pending.
              </p>
              <div className="mt-3 space-y-2">
                <select
                  value={selectedRegionId}
                  onChange={(e) => setSelectedRegionId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium"
                >
                  {company?.regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.timezone}) — {r.shift_context.current_shift?.shift_name ?? "—"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(`Simulated shift transition for ${selectedRegionId}`, () =>
                      digitalTwinApi.simulateShiftTransition(selectedRegionId)
                    )
                  }
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
                >
                  <Clock className="h-3.5 w-3.5" />
                  Simulate Shift Change
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Recent Simulation & Machine Events
                </h3>
                <button
                  type="button"
                  onClick={() => navigate("/digital-twin/events")}
                  className="text-[11px] font-semibold text-blue-700 hover:underline"
                >
                  View All →
                </button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto text-xs">
                {mergedEvents.map((ev) => (
                  <div key={ev.id} className="rounded border border-slate-100 bg-slate-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-blue-700">{ev.machine_id}</span>
                      <StatusBadge status={ev.new_status ?? "Unknown"} size="sm" />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-700">{ev.message}</p>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">Control Action Log</h3>
              <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-600">
                {log.length === 0 ? (
                  <p className="text-slate-400">Ready — click Start Simulation or Step 1 Tick.</p>
                ) : (
                  log.map((entry, idx) => (
                    <div key={idx} className="border-b border-slate-100 py-1">
                      {entry}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
};
