import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Factory } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { TwinCanvas } from "../components/three/TwinCanvas";
import { RegionScene } from "../components/three/RegionScene";
import { OverviewFallback, SummaryStrip } from "../components/ui/OverviewFallback";
import { ShiftSchedulePanel } from "../components/ui/ShiftSchedulePanel";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { RegionDetail } from "../types/digitalTwin";

export const RegionPage: React.FC = () => {
  const { regionId } = useParams<{ regionId: string }>();
  const navigate = useNavigate();
  const { overviewMode, structuralVersion, lastSyncAt } = useTwinStore();
  const [region, setRegion] = useState<RegionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!regionId) return;
    try {
      const data = await digitalTwinApi.getRegionDetail(regionId);
      setRegion(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [regionId]);

  useEffect(() => {
    load();
  }, [load, structuralVersion, lastSyncAt]);

  const fallbackView = useMemo(() => {
    if (!region) return null;
    return (
      <OverviewFallback
        title={`${region.name} — Manufacturing Facilities`}
        items={region.factories.map((f) => ({
          id: f.id,
          code: f.code,
          name: f.name,
          subtitle: `${f.facility_type} • Shift: ${f.shift_context.current_shift?.shift_name ?? "—"}`,
          metrics: `${f.summary.running_machines}/${f.summary.total_machines} Run • OEE ${f.summary.overall_oee}%`,
          status: f.summary.faulted_machines > 0 ? "Fault" : "Running",
          onOpen: () => navigate(`/digital-twin/factory/${f.id}`),
        }))}
      />
    );
  }, [region, navigate]);

  return (
    <AppShell
      breadcrumbs={region ? [{ label: region.name }] : [{ label: "Region" }]}
      title={region?.name ?? "Loading Region…"}
      subtitle={region ? `${region.country} • Timezone ${region.timezone}` : undefined}
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

      {region && (
        <div className="relative h-full w-full">
          <div className="pointer-events-none absolute left-4 right-4 top-3 z-10">
            <SummaryStrip summary={region.summary} />
          </div>

          {overviewMode ? (
            <div className="h-full pt-20">{fallbackView}</div>
          ) : (
            <TwinCanvas initialCameraPosition={[0, 18, 28]} fallback={fallbackView}>
              <RegionScene region={region} onSelectFactory={(id) => navigate(`/digital-twin/factory/${id}`)} />
            </TwinCanvas>
          )}

          {/* Regional Facilities + Independent Shift Schedule Panel */}
          {!overviewMode && (
            <aside className="absolute bottom-4 right-4 top-24 z-10 hidden w-96 flex-col gap-3 overflow-y-auto lg:flex">
              <div className="rounded-lg border border-slate-200 bg-white/95 p-3.5 shadow-lg">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Regional Factories ({region.factories.length})
                </h3>
                <div className="mt-2.5 space-y-2">
                  {region.factories.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => navigate(`/digital-twin/factory/${f.id}`)}
                      className="flex w-full items-center justify-between rounded border border-slate-200 bg-white p-2.5 text-left transition hover:border-blue-600 hover:bg-blue-50/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Factory className="h-3.5 w-3.5 text-blue-700" />
                          <span className="font-mono text-[10px] font-bold text-blue-700">{f.code}</span>
                        </div>
                        <div className="truncate text-xs font-bold text-slate-900">{f.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {f.summary.running_machines}/{f.summary.total_machines} Run • OEE {f.summary.overall_oee}% •
                          Handovers Pending: {f.summary.pending_handovers}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>

              <ShiftSchedulePanel shiftContext={region.shift_context} onUpdated={load} />
            </aside>
          )}
        </div>
      )}
    </AppShell>
  );
};

