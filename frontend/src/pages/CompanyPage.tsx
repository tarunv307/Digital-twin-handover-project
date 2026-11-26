import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Globe2, Factory } from "lucide-react";
import { motion } from "framer-motion";
import { AppShell } from "../components/layout/AppShell";
import { TwinCanvas } from "../components/three/TwinCanvas";
import { CompanyScene } from "../components/three/CompanyScene";
import { OverviewFallback, SummaryStrip } from "../components/ui/OverviewFallback";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { CompanyOverview } from "../types/digitalTwin";

export const CompanyPage: React.FC = () => {
  const navigate = useNavigate();
  const { overviewMode, structuralVersion, lastSyncAt, currentUser } = useTwinStore();
  const [company, setCompany] = useState<CompanyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await digitalTwinApi.getCompanyHierarchy();
      setCompany(data as unknown as CompanyOverview);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, structuralVersion, lastSyncAt, currentUser]);

  // Periodically refresh aggregated company metrics when simulation ticks arrive
  useEffect(() => {
    const id = window.setInterval(load, 6000);
    return () => window.clearInterval(id);
  }, [load]);

  const fallbackView = useMemo(() => {
    if (!company) return null;
    return (
      <OverviewFallback
        title="Enterprise Regional Overview"
        items={company.regions.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          subtitle: `${r.country} • ${r.timezone} • Active: ${r.shift_context.current_shift?.shift_name ?? "—"}`,
          metrics: `${r.summary.total_factories} Factories • ${r.summary.running_machines}/${r.summary.total_machines} Run • OEE ${r.summary.overall_oee}%`,
          status: r.summary.faulted_machines > 0 ? "Fault" : "Running",
          onOpen: () => navigate(`/digital-twin/region/${r.id}`),
        }))}
      />
    );
  }, [company, navigate]);

  return (
    <AppShell
      breadcrumbs={[]}
      title={company?.name ?? "Loading Enterprise Digital Twin…"}
      subtitle={company ? `${company.headquarters} • ${company.industry_sector}` : undefined}
    >
      {error && (
        <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {!company && !error && (
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading company Digital Twin…
        </div>
      )}

      {company && (
        <div className="relative h-full w-full">
          {/* Top KPI Strip */}
          <div className="pointer-events-none absolute left-4 right-4 top-3 z-10">
            <SummaryStrip summary={company.summary} />
          </div>

          {/* 3D Scene or Overview Fallback */}
          {overviewMode ? (
            <div className="h-full pt-20">{fallbackView}</div>
          ) : (
            <TwinCanvas initialCameraPosition={[0, 26, 44]} fallback={fallbackView}>
              <CompanyScene
                company={company}
                onSelectRegion={(id) => navigate(`/digital-twin/region/${id}`)}
                onSelectFactory={(id) => navigate(`/digital-twin/factory/${id}`)}
              />
            </TwinCanvas>
          )}

          {/* Right Regional Directory Drawer */}
          {!overviewMode && (
            <motion.aside
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              className="absolute bottom-4 right-4 top-24 z-10 hidden w-80 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-sm lg:flex"
            >
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                  <Globe2 className="h-4 w-4 text-blue-700" />
                  <span>Operating Regions ({company.regions.length})</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Click any region or 3D building to drill down.
                </p>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
                {company.regions.map((region) => (
                  <div
                    key={region.id}
                    className="rounded-md border border-slate-200 bg-white p-3 transition hover:border-blue-500"
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/digital-twin/region/${region.id}`)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <span className="font-mono text-[10px] font-bold text-blue-700">{region.code}</span>
                        <div className="text-sm font-bold text-slate-900">{region.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {region.timezone} • {region.shift_context.current_shift?.shift_name ?? "—"}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>

                    <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-slate-100 pt-2 font-mono text-[11px]">
                      <div>
                        <span className="text-slate-400">Run </span>
                        <span className="font-semibold text-emerald-700">
                          {region.summary.running_machines}/{region.summary.total_machines}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">OEE </span>
                        <span className="font-semibold text-blue-700">{region.summary.overall_oee}%</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Fault </span>
                        <span
                          className={`font-semibold ${
                            region.summary.faulted_machines > 0 ? "text-red-600" : "text-slate-700"
                          }`}
                        >
                          {region.summary.faulted_machines}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 space-y-1">
                      {region.factories.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => navigate(`/digital-twin/factory/${f.id}`)}
                          className="flex w-full items-center justify-between rounded bg-slate-50 px-2 py-1 text-left text-[11px] text-slate-700 hover:bg-blue-50 hover:text-blue-800"
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <Factory className="h-3 w-3 shrink-0 text-slate-400" />
                            <span className="truncate">{f.name}</span>
                          </span>
                          <span className="font-mono text-[10px] font-semibold">{f.summary.overall_oee}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.aside>
          )}
        </div>
      )}
    </AppShell>
  );
};

