import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Cpu,
  DoorOpen,
  Eye,
  Footprints,
  Gauge,
  GitCommitHorizontal,
  Thermometer,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { TwinCanvas } from "../components/three/TwinCanvas";
import {
  FactoryScene,
  type FactoryViewMode,
  type InteriorCameraPreset,
} from "../components/three/FactoryScene";
import { OverviewFallback, SummaryStrip } from "../components/ui/OverviewFallback";
import { StatusBadge } from "../components/ui/StatusBadge";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type {
  FactoryDetail,
  MachineDetail,
  MachineWorkspace,
} from "../types/digitalTwin";

export const FactoryPage: React.FC = () => {
  const { factoryId } = useParams<{ factoryId: string }>();
  const navigate = useNavigate();
  const { currentUser, overviewMode, structuralVersion, liveStates, lastSyncAt } = useTwinStore();

  const [factory, setFactory] = useState<FactoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<FactoryViewMode>("exterior");
  const [interiorPreset, setInteriorPreset] = useState<InteriorCameraPreset>("overview");
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);

  const [selectedDetail, setSelectedDetail] = useState<MachineDetail | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<MachineWorkspace | null>(null);
  const [machineLoading, setMachineLoading] = useState(false);

  // Reset exterior mode whenever switching factories
  useEffect(() => {
    setViewMode("exterior");
    setInteriorPreset("overview");
    setSelectedMachineId(null);
    setSelectedDetail(null);
    setSelectedWorkspace(null);
  }, [factoryId]);

  const load = useCallback(async () => {
    if (!factoryId) return;
    try {
      const data = await digitalTwinApi.getFactoryDetail(factoryId);
      setFactory(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [factoryId]);

  useEffect(() => {
    load();
  }, [load, structuralVersion, lastSyncAt]);

  // Fetch backend detail + workspace when an individual machine is selected inside 3D
  useEffect(() => {
    if (!selectedMachineId) {
      setSelectedDetail(null);
      setSelectedWorkspace(null);
      return;
    }
    let active = true;
    setMachineLoading(true);
    digitalTwinApi
      .getMachineDetail(selectedMachineId)
      .then((res) => {
        if (active) setSelectedDetail(res);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setMachineLoading(false);
      });

    if (currentUser) {
      digitalTwinApi
        .getMachineWorkspace(selectedMachineId)
        .then((ws) => {
          if (active) setSelectedWorkspace(ws);
        })
        .catch(() => {});
    } else {
      setSelectedWorkspace(null);
    }

    return () => {
      active = false;
    };
  }, [selectedMachineId, currentUser]);

  const enterFactory = () => {
    setViewMode("interior");
    setInteriorPreset("overview");
  };

  const exitToExterior = () => {
    setSelectedMachineId(null);
    setViewMode("exterior");
  };

  const selectMachineOnFloor = (machineId: string) => {
    if (viewMode === "exterior") {
      setViewMode("interior");
    }
    setSelectedMachineId(machineId);
  };

  const fallbackView = useMemo(() => {
    if (!factory) return null;
    return (
      <OverviewFallback
        title={`${factory.name} — Production Lines`}
        items={factory.production_lines.map((line) => ({
          id: line.id,
          code: line.code,
          name: line.name,
          subtitle: `${line.process_type} • ${line.machines.length} Machines in sequence`,
          metrics: `OEE ${line.summary.overall_oee}% • Prod ${line.summary.total_production}/${line.summary.total_target}`,
          status: line.summary.faulted_machines > 0 ? "Fault" : "Running",
          onOpen: () => navigate(`/digital-twin/line/${line.id}`),
        }))}
      />
    );
  }, [factory, navigate]);

  const liveSelectedState = selectedMachineId
    ? liveStates[selectedMachineId] ?? selectedDetail?.state
    : null;

  return (
    <AppShell
      breadcrumbs={
        factory
          ? [
              { label: factory.region_name, to: `/digital-twin/region/${factory.region_id}` },
              { label: factory.name },
            ]
          : [{ label: "Factory" }]
      }
      title={factory?.name ?? "Loading Factory Floor…"}
      subtitle={
        factory
          ? `${factory.facility_type} • ${
              viewMode === "exterior" ? "Exterior Campus View" : "Interior Production Hall"
            } • Active Shift: ${factory.shift_context.current_shift?.shift_name ?? "Outside shift"} (${
              factory.timezone
            })`
          : undefined
      }
      actions={
        <div className="flex items-center gap-2">
          {!overviewMode && factory && (
            <button
              type="button"
              onClick={() => (viewMode === "exterior" ? enterFactory() : exitToExterior())}
              className="inline-flex items-center gap-1.5 rounded bg-[#2563EB] px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
            >
              {viewMode === "exterior" ? (
                <>
                  <DoorOpen className="h-3.5 w-3.5" />
                  Enter Factory
                </>
              ) : (
                <>
                  <Building2 className="h-3.5 w-3.5" />
                  Exterior View
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/digital-twin")}
            className="inline-flex items-center gap-1 rounded border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-[#EAF2FC]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Company
          </button>
        </div>
      }
    >
      {error && (
        <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {factory && (
        <div className="relative h-full w-full">
          <div className="pointer-events-none absolute left-4 right-4 top-3 z-10">
            <SummaryStrip summary={factory.summary} />
          </div>

          {overviewMode ? (
            <div className="h-full pt-20">{fallbackView}</div>
          ) : (
            <TwinCanvas
              initialCameraPosition={[
                (factory.floor_width_m || 90) * 0.56,
                26,
                (factory.floor_depth_m || 56) * 0.92,
              ]}
              fallback={fallbackView}
            >
              <FactoryScene
                factory={factory}
                viewMode={viewMode}
                interiorPreset={interiorPreset}
                selectedMachineId={selectedMachineId}
                onEnterFactory={enterFactory}
                onEnterLine={(lineId) => navigate(`/digital-twin/line/${lineId}`)}
                onSelectMachine={selectMachineOnFloor}
              />
            </TwinCanvas>
          )}

          {/* Exterior Primary "Enter Factory" CTA Bar */}
          {!overviewMode && viewMode === "exterior" && (
            <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#DCE6F2] bg-white/95 px-4 py-2.5 shadow-lg">
              <div className="hidden text-xs text-[#334155] sm:block">
                Drag to orbit plant exterior • Scroll to zoom
              </div>
              <button
                type="button"
                onClick={enterFactory}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                <DoorOpen className="h-4 w-4" />
                Enter Factory Interior
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Interior Camera Presets Pill */}
          {!overviewMode && viewMode === "interior" && (
            <div className="absolute bottom-5 left-4 z-10 flex flex-wrap items-center gap-1.5 rounded-xl border border-[#DCE6F2] bg-white/95 p-1.5 shadow-md">
              <button
                type="button"
                onClick={() => {
                  setSelectedMachineId(null);
                  setInteriorPreset("overview");
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                  interiorPreset === "overview" && !selectedMachineId
                    ? "bg-[#2563EB] text-white"
                    : "text-[#14213D] hover:bg-[#EAF2FC]"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                Hall Overview
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedMachineId(null);
                  setInteriorPreset("walk");
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                  interiorPreset === "walk" && !selectedMachineId
                    ? "bg-[#2563EB] text-white"
                    : "text-[#14213D] hover:bg-[#EAF2FC]"
                }`}
              >
                <Footprints className="h-3.5 w-3.5" />
                Walk Floor
              </button>
              <button
                type="button"
                onClick={exitToExterior}
                className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] px-2.5 py-1.5 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
              >
                <Building2 className="h-3.5 w-3.5 text-[#2563EB]" />
                Exterior
              </button>
            </div>
          )}

          {/* Right Drawer: Selected Machine Inspector OR Production Lines Explorer */}
          {!overviewMode && (
            <aside className="absolute bottom-4 right-4 top-24 z-10 hidden w-88 flex-col overflow-hidden rounded-xl border border-[#DCE6F2] bg-white/95 shadow-lg lg:flex">
              {selectedMachineId ? (
                <>
                  <div className="flex items-center justify-between border-b border-[#DCE6F2] bg-[#EAF2FC]/65 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                      <Cpu className="h-4 w-4 text-[#2563EB]" />
                      <span>Selected Machine</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedMachineId(null)}
                      aria-label="Close machine selection"
                      className="rounded p-1 text-slate-500 hover:bg-white hover:text-[#14213D]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-xs">
                    {machineLoading && !selectedDetail ? (
                      <div className="p-4 text-center text-slate-500">Loading machine telemetry…</div>
                    ) : selectedDetail ? (
                      <>
                        <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-mono text-[10px] font-bold uppercase text-[#2563EB]">
                                {selectedDetail.code} • {selectedDetail.line_name}
                              </span>
                              <h4 className="mt-0.5 text-sm font-bold text-[#14213D]">
                                {selectedDetail.name}
                              </h4>
                            </div>
                            <StatusBadge status={liveSelectedState?.status} size="sm" />
                          </div>
                          {liveSelectedState?.assigned_operator && (
                            <div className="mt-1.5 text-[11px] text-[#334155]">
                              Operator: <strong>{liveSelectedState.assigned_operator}</strong>
                            </div>
                          )}
                        </div>

                        {/* Live Telemetry */}
                        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Gauge className="h-3 w-3 text-[#2563EB]" /> OEE
                            </div>
                            <div className="font-bold text-[#14213D]">
                              {liveSelectedState?.oee_pct ?? 0}%
                            </div>
                          </div>
                          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Thermometer className="h-3 w-3 text-[#2563EB]" /> Temp
                            </div>
                            <div className="font-bold text-[#14213D]">
                              {liveSelectedState?.temperature_c ?? "—"} °C
                            </div>
                          </div>
                          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Activity className="h-3 w-3 text-[#2563EB]" /> Vibration
                            </div>
                            <div className="font-bold text-[#14213D]">
                              {liveSelectedState?.vibration_mm_s ?? "—"} mm/s
                            </div>
                          </div>
                          <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Zap className="h-3 w-3 text-[#2563EB]" /> Power
                            </div>
                            <div className="font-bold text-[#14213D]">
                              {liveSelectedState?.energy_kw ?? "—"} kW
                            </div>
                          </div>
                        </div>

                        {/* Production Output */}
                        <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
                          <div className="flex justify-between text-[11px]">
                            <span className="font-semibold text-[#334155]">Shift Production</span>
                            <strong className="font-mono text-[#14213D]">
                              {liveSelectedState?.production_count ?? 0} /{" "}
                              {liveSelectedState?.production_target ?? 0} units
                            </strong>
                          </div>
                        </div>

                        {/* Abnormalities & Maintenance */}
                        {selectedWorkspace && (
                          <div className="space-y-2">
                            <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
                              <div className="flex items-center justify-between text-[11px] font-bold text-[#14213D]">
                                <span className="flex items-center gap-1">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                  Abnormalities
                                </span>
                                <span className="font-mono">{selectedWorkspace.abnormalities.length}</span>
                              </div>
                              {selectedWorkspace.abnormalities[0] && (
                                <div className="mt-1 truncate text-[11px] text-slate-600">
                                  Latest: {selectedWorkspace.abnormalities[0].title}
                                </div>
                              )}
                            </div>
                            <div className="rounded-lg border border-[#DCE6F2] bg-white p-2.5">
                              <div className="flex items-center justify-between text-[11px] font-bold text-[#14213D]">
                                <span className="flex items-center gap-1">
                                  <Wrench className="h-3.5 w-3.5 text-[#2563EB]" />
                                  Maintenance Records
                                </span>
                                <span className="font-mono">{selectedWorkspace.maintenance_records.length}</span>
                              </div>
                              {selectedWorkspace.maintenance_records[0] && (
                                <div className="mt-1 truncate text-[11px] text-slate-600">
                                  Latest: {selectedWorkspace.maintenance_records[0].summary}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => navigate(`/digital-twin/machine/${selectedDetail.id}`)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Open Machine Details Twin
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="border-b border-[#DCE6F2] bg-[#EAF2FC]/60 px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                      <GitCommitHorizontal className="h-4 w-4 text-[#2563EB]" />
                      <span>Production Lines ({factory.production_lines.length})</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Click any machine in 3D or below to focus and inspect live telemetry.
                    </p>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    {factory.production_lines.map((line) => (
                      <div key={line.id} className="rounded-xl border border-[#DCE6F2] bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-mono text-[10px] font-bold text-[#2563EB]">{line.code}</span>
                            <h4 className="text-sm font-bold text-[#14213D]">{line.name}</h4>
                            <p className="text-[11px] text-slate-500">{line.process_type}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate(`/digital-twin/line/${line.id}`)}
                            className="inline-flex shrink-0 items-center gap-1 rounded bg-[#2563EB] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            Line View
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-2.5 space-y-1 border-t border-[#DCE6F2] pt-2">
                          {line.machines.map((m) => {
                            const st = liveStates[m.id] ?? m.state;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => selectMachineOnFloor(m.id)}
                                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-[#EAF2FC]"
                              >
                                <span className="truncate font-medium text-[#14213D]">
                                  <span className="mr-1.5 font-mono text-[10px] text-slate-400">
                                    #{String(m.sequence_order).padStart(2, "0")}
                                  </span>
                                  {m.code}
                                </span>
                                <StatusBadge status={st?.status} size="sm" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          )}

          {/* Mobile / Tablet Compact Selected Machine Bar */}
          {!overviewMode && selectedMachineId && selectedDetail && (
            <div className="absolute bottom-16 left-4 right-4 z-10 rounded-xl border border-[#DCE6F2] bg-white/95 p-3 shadow-lg lg:hidden">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] font-bold text-[#2563EB]">{selectedDetail.code}</span>
                  <h4 className="text-xs font-bold text-[#14213D]">{selectedDetail.name}</h4>
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    OEE {liveSelectedState?.oee_pct ?? 0}% • {liveSelectedState?.production_count ?? 0}/
                    {liveSelectedState?.production_target ?? 0} units
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/digital-twin/machine/${selectedDetail.id}`)}
                    className="rounded-lg bg-[#2563EB] px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    Machine Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedMachineId(null)}
                    aria-label="Close selection"
                    className="rounded p-1 text-slate-500 hover:bg-[#EAF2FC]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
};
