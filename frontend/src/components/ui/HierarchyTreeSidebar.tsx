import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  ChevronRight,
  Cpu,
  Factory,
  GitCommitHorizontal,
  Globe2,
  Search,
  X,
} from "lucide-react";
import { digitalTwinApi } from "../../services/api";
import { useTwinStore } from "../../store/twinStore";
import type { CompanyHierarchy, MachineSummary, MachineStatus } from "../../types/digitalTwin";

interface HierarchyTreeSidebarProps {
  onNavigate?: () => void;
  embedded?: boolean;
}

const statusDotClass = (status?: MachineStatus | string) => {
  switch (status) {
    case "Running":
      return "bg-emerald-600";
    case "Fault":
      return "bg-red-600 animate-pulse";
    case "Maintenance":
      return "bg-sky-600";
    case "Idle":
      return "bg-amber-500";
    case "Stopped":
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
};

export const HierarchyTreeSidebar: React.FC<HierarchyTreeSidebarProps> = ({
  onNavigate,
  embedded = false,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { regionId, factoryId, lineId, machineId } = useParams<{
    regionId?: string;
    factoryId?: string;
    lineId?: string;
    machineId?: string;
  }>();
  const { currentUser, liveStates, structuralVersion, lastSyncAt } = useTwinStore();

  const [hierarchy, setHierarchy] = useState<CompanyHierarchy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loadHierarchy = useCallback(async () => {
    try {
      const data = await digitalTwinApi.getCompanyHierarchy();
      setHierarchy(data);
      setError(null);
      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<string, boolean> = {};
        data.regions.forEach((r) => {
          initial[`reg:${r.id}`] = true;
        });
        return initial;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHierarchy();
  }, [loadHierarchy, currentUser, structuralVersion]);

  useEffect(() => {
    const t = window.setInterval(loadHierarchy, 10000);
    return () => window.clearInterval(t);
  }, [loadHierarchy, lastSyncAt]);

  // Auto-expand ancestor nodes when navigating to a deep node via 3D click or URL
  useEffect(() => {
    if (!hierarchy) return;
    setExpanded((prev) => {
      const next = { ...prev };
      hierarchy.regions.forEach((reg) => {
        if (reg.id === regionId) next[`reg:${reg.id}`] = true;
        reg.factories.forEach((fac) => {
          if (fac.id === factoryId) {
            next[`reg:${reg.id}`] = true;
            next[`fac:${fac.id}`] = true;
          }
          fac.production_lines.forEach((line) => {
            if (line.id === lineId) {
              next[`reg:${reg.id}`] = true;
              next[`fac:${fac.id}`] = true;
              next[`line:${line.id}`] = true;
            }
            if (machineId && line.machines.some((m) => m.id === machineId)) {
              next[`reg:${reg.id}`] = true;
              next[`fac:${fac.id}`] = true;
              next[`line:${line.id}`] = true;
            }
          });
        });
      });
      return next;
    });
  }, [hierarchy, regionId, factoryId, lineId, machineId]);

  const toggleNode = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const countLiveFaults = useCallback(
    (machines: MachineSummary[]) =>
      machines.reduce((acc, m) => {
        const st = liveStates[m.id] ?? m.state;
        return acc + (st?.status === "Fault" ? 1 : 0);
      }, 0),
    [liveStates]
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredRegions = useMemo(() => {
    if (!hierarchy) return [];
    if (!normalizedQuery) return hierarchy.regions;
    return hierarchy.regions
      .map((reg) => {
        const regMatches =
          reg.name.toLowerCase().includes(normalizedQuery) || reg.code.toLowerCase().includes(normalizedQuery);
        const matchedFactories = reg.factories
          .map((fac) => {
            const facMatches =
              fac.name.toLowerCase().includes(normalizedQuery) || fac.code.toLowerCase().includes(normalizedQuery);
            const matchedLines = fac.production_lines
              .map((line) => {
                const lineMatches =
                  line.name.toLowerCase().includes(normalizedQuery) || line.code.toLowerCase().includes(normalizedQuery);
                const matchedMachines = line.machines.filter(
                  (m) =>
                    m.name.toLowerCase().includes(normalizedQuery) ||
                    m.code.toLowerCase().includes(normalizedQuery) ||
                    m.id.toLowerCase().includes(normalizedQuery)
                );
                if (lineMatches || regMatches || facMatches) {
                  return line;
                }
                if (matchedMachines.length > 0) {
                  return { ...line, machines: matchedMachines };
                }
                return null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
            if (facMatches || regMatches) {
              return fac;
            }
            if (matchedLines.length > 0) {
              return { ...fac, production_lines: matchedLines };
            }
            return null;
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        if (regMatches) return reg;
        if (matchedFactories.length > 0) return { ...reg, factories: matchedFactories };
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [hierarchy, normalizedQuery]);

  const goTo = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const isCompanyActive = location.pathname === "/digital-twin";

  return (
    <div className="flex h-full flex-col bg-white text-slate-900">
      {/* Top Hierarchy Header + Back to Company */}
      <div className="border-b border-[#DCE6F2] bg-[#EAF2FC]/60 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#14213D]">
            {embedded ? "Company → Region → Factory → Line → Machine" : "Operations Hierarchy"}
          </span>
          {!isCompanyActive && !embedded && (
            <button
              type="button"
              onClick={() => goTo("/digital-twin")}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to Company
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plant, line, asset ID…"
            aria-label="Search hierarchy"
            className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1.5 rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {loading && !hierarchy && (
          <div className="p-4 text-center text-xs text-slate-500">Loading plant hierarchy…</div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
        )}

        {hierarchy && (
          <div className="space-y-1">
            {/* Root Company Node */}
            <button
              type="button"
              onClick={() => goTo("/digital-twin")}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-bold transition ${
                isCompanyActive
                  ? "border border-[#93C5FD] bg-[#DBEAFE] text-[#14213D]"
                  : "border border-transparent bg-[#EAF2FC] text-[#14213D] hover:bg-[#E3EEFF]"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-[#2563EB]" />
                <span className="truncate">{hierarchy.name}</span>
              </span>
              <span className="ml-2 flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
                <span className="rounded border border-[#DCE6F2] bg-white px-1.5 py-0.5 text-[#334155]">
                  {hierarchy.summary.total_machines}M
                </span>
                {hierarchy.summary.faulted_machines > 0 && (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-white">
                    {hierarchy.summary.faulted_machines}F
                  </span>
                )}
              </span>
            </button>

            {filteredRegions.length === 0 ? (
              <div className="rounded border border-[#DCE6F2] bg-[#EAF2FC] p-3 text-center text-xs text-[#64748B]">
                {normalizedQuery
                  ? `No authorized nodes match "${query}".`
                  : "No machines currently assigned to your account."}
              </div>
            ) : (
              <div className="space-y-1 pl-1 pt-1">
                {filteredRegions.map((reg) => {
                  const regOpen = Boolean(normalizedQuery) || Boolean(expanded[`reg:${reg.id}`]);
                  const regActive = regionId === reg.id && !factoryId && !lineId && !machineId;
                  const regMachines = reg.factories.flatMap((f) => f.production_lines.flatMap((l) => l.machines));
                  const regFaults = countLiveFaults(regMachines);

                  return (
                    <div key={reg.id} className="rounded-md">
                      <div
                        className={`flex items-center justify-between rounded px-1.5 py-1.5 text-xs transition ${
                          regActive
                            ? "bg-[#DBEAFE] font-semibold text-[#14213D] ring-1 ring-[#93C5FD]"
                            : "text-[#334155] hover:bg-[#E3EEFF]"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleNode(`reg:${reg.id}`)}
                            aria-label={`Toggle ${reg.name}`}
                            className="rounded p-0.5 text-[#64748B] hover:bg-[#DBEAFE] hover:text-[#14213D]"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-transform duration-150 ${regOpen ? "rotate-90" : ""}`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setExpanded((p) => ({ ...p, [`reg:${reg.id}`]: true }));
                              goTo(`/digital-twin/region/${reg.id}`);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold text-[#14213D]"
                          >
                            <Globe2 className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                            <span className="truncate">{reg.name}</span>
                          </button>
                        </div>
                        <span className="ml-1 flex shrink-0 items-center gap-1 font-mono text-[10px]">
                          <span className="text-[#64748B]">{regMachines.length}</span>
                          {regFaults > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 font-bold text-red-700">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {regFaults}
                            </span>
                          )}
                        </span>
                      </div>

                      <AnimatePresence initial={false}>
                        {regOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.16 }}
                            className="ml-3 mt-0.5 space-y-0.5 overflow-hidden border-l border-[#C3D5EB] pl-2.5"
                          >
                            {reg.factories.map((fac) => {
                              const facOpen = Boolean(normalizedQuery) || Boolean(expanded[`fac:${fac.id}`]);
                              const facActive = factoryId === fac.id && !lineId && !machineId;
                              const facMachines = fac.production_lines.flatMap((l) => l.machines);
                              const facFaults = countLiveFaults(facMachines);

                              return (
                                <div key={fac.id}>
                                  <div
                                    className={`flex items-center justify-between rounded px-1.5 py-1.5 text-xs transition ${
                                      facActive
                                        ? "bg-[#DBEAFE] font-semibold text-[#14213D] ring-1 ring-[#93C5FD]"
                                        : "text-[#334155] hover:bg-[#E3EEFF]"
                                    }`}
                                  >
                                    <div className="flex min-w-0 flex-1 items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => toggleNode(`fac:${fac.id}`)}
                                        aria-label={`Toggle ${fac.name}`}
                                        className="rounded p-0.5 text-[#64748B] hover:bg-[#DBEAFE] hover:text-[#14213D]"
                                      >
                                        <ChevronRight
                                          className={`h-3.5 w-3.5 transition-transform duration-150 ${
                                            facOpen ? "rotate-90" : ""
                                          }`}
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setExpanded((p) => ({
                                            ...p,
                                            [`reg:${reg.id}`]: true,
                                            [`fac:${fac.id}`]: true,
                                          }));
                                          goTo(`/digital-twin/factory/${fac.id}`);
                                        }}
                                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium text-[#14213D]"
                                      >
                                        <Factory className="h-3.5 w-3.5 shrink-0 text-[#4A6A93]" />
                                        <span className="truncate">{fac.name}</span>
                                      </button>
                                    </div>
                                    <span className="ml-1 flex shrink-0 items-center gap-1 font-mono text-[10px]">
                                      <span className="text-[#64748B]">{facMachines.length}</span>
                                      {facFaults > 0 && (
                                        <span className="rounded bg-red-100 px-1 py-0.5 font-bold text-red-700">
                                          {facFaults}F
                                        </span>
                                      )}
                                    </span>
                                  </div>

                                  <AnimatePresence initial={false}>
                                    {facOpen && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.16 }}
                                        className="ml-3 mt-0.5 space-y-0.5 overflow-hidden border-l border-[#C3D5EB] pl-2.5"
                                      >
                                        {fac.production_lines.map((line) => {
                                          const lineOpen =
                                            Boolean(normalizedQuery) || Boolean(expanded[`line:${line.id}`]);
                                          const lineActive = lineId === line.id && !machineId;
                                          const lineFaults = countLiveFaults(line.machines);

                                          return (
                                            <div key={line.id}>
                                              <div
                                                className={`flex items-center justify-between rounded px-1.5 py-1 text-[11px] transition ${
                                                  lineActive
                                                    ? "bg-[#DBEAFE] font-semibold text-[#14213D] ring-1 ring-[#93C5FD]"
                                                    : "text-[#334155] hover:bg-[#E3EEFF]"
                                                }`}
                                              >
                                                <div className="flex min-w-0 flex-1 items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => toggleNode(`line:${line.id}`)}
                                                    aria-label={`Toggle ${line.name}`}
                                                    className="rounded p-0.5 text-[#64748B] hover:bg-[#DBEAFE] hover:text-[#14213D]"
                                                  >
                                                    <ChevronRight
                                                      className={`h-3 w-3 transition-transform duration-150 ${
                                                        lineOpen ? "rotate-90" : ""
                                                      }`}
                                                    />
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setExpanded((p) => ({
                                                        ...p,
                                                        [`reg:${reg.id}`]: true,
                                                        [`fac:${fac.id}`]: true,
                                                        [`line:${line.id}`]: true,
                                                      }));
                                                      goTo(`/digital-twin/line/${line.id}`);
                                                    }}
                                                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[#334155]"
                                                  >
                                                    <GitCommitHorizontal className="h-3 w-3 shrink-0 text-[#2563EB]" />
                                                    <span className="truncate">{line.name}</span>
                                                  </button>
                                                </div>
                                                <span className="ml-1 flex shrink-0 items-center gap-1 font-mono text-[10px]">
                                                  <span className="text-[#64748B]">{line.machines.length}</span>
                                                  {lineFaults > 0 && (
                                                    <span className="rounded bg-red-100 px-1 text-red-700 font-bold">
                                                      {lineFaults}F
                                                    </span>
                                                  )}
                                                </span>
                                              </div>

                                              <AnimatePresence initial={false}>
                                                {lineOpen && (
                                                  <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.14 }}
                                                    className="ml-3 mt-0.5 space-y-0.5 overflow-hidden border-l border-[#C3D5EB] pl-2"
                                                  >
                                                    {line.machines.map((m) => {
                                                      const st = liveStates[m.id] ?? m.state;
                                                      const mActive = machineId === m.id;
                                                      return (
                                                        <button
                                                          key={m.id}
                                                          type="button"
                                                          onClick={() => goTo(`/digital-twin/machine/${m.id}`)}
                                                          className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] transition ${
                                                            mActive
                                                              ? "bg-[#DBEAFE] font-semibold text-[#14213D] ring-1 ring-[#93C5FD]"
                                                              : "text-[#334155] hover:bg-[#E3EEFF]"
                                                          }`}
                                                        >
                                                          <span className="flex min-w-0 items-center gap-1.5">
                                                            <span
                                                              className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(
                                                                st?.status
                                                              )}`}
                                                              title={st?.status ?? "Unknown"}
                                                            />
                                                            <Cpu
                                                              className={`h-3 w-3 shrink-0 ${
                                                                mActive ? "text-[#2563EB]" : "text-[#4A6A93]"
                                                              }`}
                                                            />
                                                            <span className="font-mono text-[10px] font-bold text-[#14213D]">
                                                              {m.code}
                                                            </span>
                                                            <span className="truncate text-[#64748B]">
                                                              {m.name.split(" — ").slice(-1)[0]}
                                                            </span>
                                                          </span>
                                                          {st?.status === "Fault" && (
                                                            <span className="ml-1 rounded bg-red-100 px-1 font-mono text-[9px] font-bold uppercase text-red-700">
                                                              FAULT
                                                            </span>
                                                          )}
                                                        </button>
                                                      );
                                                    })}
                                                  </motion.div>
                                                )}
                                              </AnimatePresence>
                                            </div>
                                          );
                                        })}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scope Footer */}
      <div className="border-t border-slate-200 bg-slate-50 px-3.5 py-2 text-[10px] text-slate-500">
        {currentUser ? (
          <span>
            Scope: <strong className="text-slate-700">{currentUser.role}</strong>
          </span>
        ) : (
          <span>Enterprise Read Scope • Sign in for role controls</span>
        )}
      </div>
    </div>
  );
};
