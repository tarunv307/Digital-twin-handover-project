import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { TwinCanvas } from "../components/three/TwinCanvas";
import { LineScrollScene } from "../components/three/LineScrollScene";
import { MachineInspector } from "../components/ui/MachineInspector";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { MachineDetail, ProductionLineDetail } from "../types/digitalTwin";

export const MachineDetailPage: React.FC = () => {
  const { machineId, qrToken } = useParams<{ machineId?: string; qrToken?: string }>();
  const navigate = useNavigate();
  const { structuralVersion } = useTwinStore();
  const [machine, setMachine] = useState<MachineDetail | null>(null);
  const [line, setLine] = useState<ProductionLineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = qrToken
        ? await digitalTwinApi.getMachineByQr(qrToken)
        : machineId
          ? await digitalTwinApi.getMachineDetail(machineId)
          : null;
      if (!detail) return;
      setMachine(detail);
      const lineData = await digitalTwinApi.getLineDetail(detail.line_id);
      setLine(lineData);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [machineId, qrToken]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load, structuralVersion]);

  const machineIdx =
    line && machine ? Math.max(0, line.machines.findIndex((m) => m.id === machine.id)) : 0;

  return (
    <AppShell
      breadcrumbs={
        machine
          ? [
              { label: machine.region_name, to: `/digital-twin/region/${machine.region_id}` },
              { label: machine.factory_name, to: `/digital-twin/factory/${machine.factory_id}` },
              { label: machine.line_name, to: `/digital-twin/line/${machine.line_id}` },
              { label: machine.code },
            ]
          : [{ label: "Machine Inspection" }]
      }
      title={machine ? `${machine.code} — ${machine.name}` : "Loading Machine Twin…"}
      subtitle={machine ? `${machine.factory_name} • ${machine.line_name}` : undefined}
      showOverviewToggle={false}
      actions={
        machine && (
          <button
            type="button"
            onClick={() => navigate(`/digital-twin/line/${machine.line_id}`)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Line Journey
          </button>
        )
      }
    >
      {error && <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {machine && (
        <div className="grid h-full grid-cols-1 lg:grid-cols-12">
          {/* Left 3D Connected Twin Viewport */}
          <div className="relative h-64 border-b border-slate-200 lg:col-span-6 lg:h-full lg:border-b-0 lg:border-r">
            {line ? (
              <TwinCanvas
                initialCameraPosition={[0, 3.8, 7.6]}
                fallback={
                  <div className="flex h-full items-center justify-center bg-slate-100 p-6 text-xs text-slate-500">
                    3D viewport unavailable; inspect specifications on the right.
                  </div>
                }
              >
                <LineScrollScene
                  machines={line.machines}
                  scrollProgress={machineIdx}
                  activeMachineId={machine.id}
                  inspectionMode
                  onSelectMachine={(id) => navigate(`/digital-twin/machine/${id}`)}
                />
              </TwinCanvas>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Loading 3D machine model…
              </div>
            )}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] text-slate-600 shadow-sm">
              Drag to orbit around {machine.code} • Click adjacent stations to switch
            </div>
          </div>

          {/* Right Detailed Machine Specification & Live Telemetry */}
          <div className="h-full overflow-hidden lg:col-span-6">
            <MachineInspector machine={machine} onRefresh={load} />
          </div>
        </div>
      )}
    </AppShell>
  );
};

