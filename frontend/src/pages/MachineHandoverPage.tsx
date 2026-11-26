import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { MachineInspector } from "../components/ui/MachineInspector";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { MachineDetail } from "../types/digitalTwin";

export const MachineHandoverPage: React.FC = () => {
  const { machineId } = useParams<{ machineId: string }>();
  const navigate = useNavigate();
  const { structuralVersion } = useTwinStore();
  const [machine, setMachine] = useState<MachineDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!machineId) return;
    try {
      const data = await digitalTwinApi.getMachineDetail(machineId);
      setMachine(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [machineId]);

  useEffect(() => {
    load();
  }, [load, structuralVersion]);

  return (
    <AppShell
      breadcrumbs={
        machine
          ? [
              { label: machine.region_name, to: `/digital-twin/region/${machine.region_id}` },
              { label: machine.factory_name, to: `/digital-twin/factory/${machine.factory_id}` },
              { label: machine.line_name, to: `/digital-twin/line/${machine.line_id}` },
              { label: machine.code, to: `/digital-twin/machine/${machine.id}` },
              { label: "Shift Handover" },
            ]
          : [{ label: "Shift Handover" }]
      }
      title={machine ? `${machine.code} — Shift Handover Management` : "Loading Handover…"}
      subtitle={machine ? `${machine.factory_name} • ${machine.line_name}` : undefined}
      showOverviewToggle={false}
      actions={
        machine && (
          <button
            type="button"
            onClick={() => navigate(`/digital-twin/machine/${machine.id}`)}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to 3D Machine Twin
          </button>
        )
      }
    >
      {error && <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {machine && (
        <div className="mx-auto h-full max-w-4xl border-x border-slate-200 bg-white">
          <MachineInspector machine={machine} onRefresh={load} defaultTab="handover" />
        </div>
      )}
    </AppShell>
  );
};

