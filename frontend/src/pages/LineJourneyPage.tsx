import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Mouse, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "../components/layout/AppShell";
import { TwinCanvas } from "../components/three/TwinCanvas";
import { LineScrollScene } from "../components/three/LineScrollScene";
import { MachineSequenceList } from "../components/ui/OverviewFallback";
import { StatusBadge } from "../components/ui/StatusBadge";
import { MetricChip } from "../components/ui/MetricChip";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { ProductionLineDetail } from "../types/digitalTwin";

export const LineJourneyPage: React.FC = () => {
  const { lineId } = useParams<{ lineId: string }>();
  const navigate = useNavigate();
  const { overviewMode, liveStates, structuralVersion } = useTwinStore();
  const [line, setLine] = useState<ProductionLineDetail | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!lineId) return;
    try {
      const data = await digitalTwinApi.getLineDetail(lineId);
      setLine(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [lineId]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [load, structuralVersion]);

  const maxIdx = line ? Math.max(0, line.machines.length - 1) : 0;

  // Vertical wheel scroll -> smooth continuous camera traversal along the production line
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (!line || overviewMode) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      setScrollProgress((prev) => {
        const next = prev + delta * 0.0022;
        return Math.max(0, Math.min(maxIdx, next));
      });
    },
    [line, overviewMode, maxIdx]
  );

  // Keyboard navigation (Up/Down/Left/Right)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!line) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        setScrollProgress((p) => Math.min(maxIdx, Math.round(p) + 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        setScrollProgress((p) => Math.max(0, Math.round(p) - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [line, maxIdx]);

  const activeIdx = line ? Math.min(maxIdx, Math.max(0, Math.round(scrollProgress))) : 0;
  const activeMachine = line?.machines[activeIdx] ?? null;
  const activeState = activeMachine ? liveStates[activeMachine.id] ?? activeMachine.state : null;

  return (
    <AppShell
      breadcrumbs={
        line
          ? [
              { label: line.region_name, to: `/digital-twin/region/${line.region_id}` },
              { label: line.factory_name, to: `/digital-twin/factory/${line.factory_id}` },
              { label: line.name },
            ]
          : [{ label: "Production Line" }]
      }
      title={line?.name ?? "Loading Production Line…"}
      subtitle={
        line
          ? `${line.process_type} • Scroll vertically to move machine-by-machine (${line.machines.length} stations)`
          : undefined
      }
      actions={
        <button
          type="button"
          onClick={() => navigate("/digital-twin")}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Company
        </button>
      }
    >
      {error && <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {line && (
        <div
          ref={containerRef}
          onWheel={handleWheel}
          className="relative h-full w-full select-none overflow-hidden"
        >
          {overviewMode ? (
            <MachineSequenceList
              machines={line.machines}
              onSelect={(id) => navigate(`/digital-twin/machine/${id}`)}
            />
          ) : (
            <TwinCanvas
              initialCameraPosition={[0, 4.1, 9.8]}
              fallback={
                <MachineSequenceList
                  machines={line.machines}
                  onSelect={(id) => navigate(`/digital-twin/machine/${id}`)}
                />
              }
            >
              <LineScrollScene
                machines={line.machines}
                scrollProgress={scrollProgress}
                activeMachineId={activeMachine?.id ?? null}
                onSelectMachine={(id) => navigate(`/digital-twin/machine/${id}`)}
              />
            </TwinCanvas>
          )}

          {/* Left Sequence Progress Rail */}
          {!overviewMode && (
            <div className="absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-2 rounded-lg border border-slate-200 bg-white/95 p-2.5 shadow-md sm:flex">
              <div className="text-center font-mono text-[10px] font-bold uppercase text-slate-400">
                Sequence
              </div>
              {line.machines.map((m, idx) => {
                const st = liveStates[m.id] ?? m.state;
                const isActive = idx === activeIdx;
                const dotColor =
                  st?.status === "Fault"
                    ? "bg-red-600"
                    : st?.status === "Running"
                      ? "bg-emerald-600"
                      : st?.status === "Maintenance"
                        ? "bg-sky-600"
                        : "bg-amber-500";
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setScrollProgress(idx)}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-left transition ${
                      isActive ? "bg-blue-700 text-white" : "hover:bg-slate-100 text-slate-700"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                    <span className="font-mono text-[11px] font-semibold">
                      {String(m.sequence_order).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Bottom Scroll Guidance & Stepper */}
          {!overviewMode && (
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 shadow-md">
              <button
                type="button"
                disabled={activeIdx <= 0}
                onClick={() => setScrollProgress(Math.max(0, activeIdx - 1))}
                className="rounded-full p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                title="Previous Machine"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <Mouse className="h-3.5 w-3.5 text-blue-700" />
                <span>
                  Scroll to traverse line • Station{" "}
                  <strong className="font-mono">
                    {activeIdx + 1}/{line.machines.length}
                  </strong>
                </span>
              </div>
              <button
                type="button"
                disabled={activeIdx >= maxIdx}
                onClick={() => setScrollProgress(Math.min(maxIdx, activeIdx + 1))}
                className="rounded-full p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                title="Next Machine"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Right Active Machine Live Inspection HUD */}
          {!overviewMode && activeMachine && (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeMachine.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="absolute bottom-16 right-4 top-4 z-10 flex w-88 max-w-[calc(100vw-2rem)] flex-col justify-between overflow-y-auto rounded-lg border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:bottom-4 sm:w-96"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-bold text-blue-700">
                        STATION {String(activeMachine.sequence_order).padStart(2, "0")} • {activeMachine.code}
                      </div>
                      <h2 className="mt-0.5 text-base font-bold text-slate-900">{activeMachine.name}</h2>
                      <p className="text-xs capitalize text-slate-500">
                        Type: {activeMachine.machine_type.replace("_", " ")}
                      </p>
                    </div>
                    <StatusBadge status={activeState?.status} />
                  </div>

                  {activeState?.status === "Fault" && (
                    <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <div>
                        <div className="font-bold">{activeState.active_fault_code ?? "FAULT"}</div>
                        <div>{activeState.active_fault_message}</div>
                      </div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetricChip
                      label="Production"
                      value={`${activeState?.production_count ?? 0}/${activeState?.production_target ?? 0}`}
                      unit="pcs"
                      tone="accent"
                    />
                    <MetricChip label="OEE" value={activeState?.oee_pct ?? 0} unit="%" tone="success" />
                    <MetricChip
                      label="Temperature"
                      value={activeState?.temperature_c ?? "—"}
                      unit="°C"
                      tone={(activeState?.temperature_c ?? 0) > 70 ? "danger" : "default"}
                    />
                    <MetricChip
                      label="Vibration"
                      value={activeState?.vibration_mm_s ?? "—"}
                      unit="mm/s"
                      tone={(activeState?.vibration_mm_s ?? 0) > 4.5 ? "danger" : "default"}
                    />
                    <MetricChip label="Cycle Time" value={activeState?.cycle_time_sec ?? "—"} unit="s" />
                    <MetricChip label="Power" value={activeState?.energy_kw ?? "—"} unit="kW" />
                  </div>

                  <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Assigned Operator</span>
                      <span className="font-semibold text-slate-800">
                        {activeState?.assigned_operator ?? "Unassigned"}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span className="text-slate-500">Active Shift</span>
                      <span className="font-semibold text-slate-800">
                        {line.shift_context.current_shift?.shift_name ?? "Outside shift"}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between">
                      <span className="text-slate-500">Handover Status</span>
                      <span
                        className={`font-mono font-semibold uppercase ${
                          activeState?.handover_status === "pending" ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {activeState?.handover_status ?? "complete"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => navigate(`/digital-twin/machine/${activeMachine.id}`)}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-800"
                  >
                    Inspect Machine Specifications & Telemetry
                    <ArrowRight className="h-4 w-4" />
                  </button>
                  <span className="text-center font-mono text-[10px] text-slate-400">
                    Click 3D machine or press ↑ / ↓ arrows to move
                  </span>
                </div>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      )}
    </AppShell>
  );
};

