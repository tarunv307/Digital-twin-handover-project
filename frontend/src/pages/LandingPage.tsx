import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Gauge,
  Globe2,
  HeartPulse,
  Layers,
  LogIn,
  QrCode,
  Radio,
  ShieldCheck,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { AuthModal } from "../components/ui/AuthModal";
import { HierarchyTreeSidebar } from "../components/ui/HierarchyTreeSidebar";
import { IndustrialNetworkMap } from "../components/ui/IndustrialNetworkMap";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { CompanyHierarchy, MachineSummary } from "../types/digitalTwin";

const DIGITAL_TWIN_CAPABILITIES = [
  {
    title: "Factory Monitoring",
    desc: "Live regional and plant-level operational visibility across connected shop floors.",
    icon: Factory,
  },
  {
    title: "Machine Status",
    desc: "Real-time Running, Idle, Fault, and Maintenance state tracking per asset.",
    icon: Cpu,
  },
  {
    title: "Production Visibility",
    desc: "Shift-wise actual vs target output, good units, and line comparisons.",
    icon: Layers,
  },
  {
    title: "OEE & Performance Analytics",
    desc: "Availability, Performance, Quality, and downtime loss breakdowns.",
    icon: Gauge,
  },
  {
    title: "Abnormality Tracking",
    desc: "Structured escalation from floor issue detection to verified resolution.",
    icon: AlertTriangle,
  },
  {
    title: "Maintenance Management",
    desc: "Corrective work orders, preventive schedules, and overdue tracking.",
    icon: Wrench,
  },
  {
    title: "Safety Checklist",
    desc: "Digital start-of-shift safety inspections with supervisory review.",
    icon: ShieldCheck,
  },
  {
    title: "Quality & Defect Management",
    desc: "Inspected, rejected, and reworked unit logging with defect categories.",
    icon: CheckCircle2,
  },
  {
    title: "Energy Monitoring",
    desc: "Real-time kW load visibility across active machines and lines.",
    icon: Zap,
  },
  {
    title: "Machine Health",
    desc: "Temperature, vibration, and cycle-time diagnostics for proactive action.",
    icon: HeartPulse,
  },
  {
    title: "QR Machine Passport",
    desc: "Scan-ready digital passport linking straight to asset logs and twin state.",
    icon: QrCode,
  },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentUser,
    setAuthModalOpen,
    logoutUser,
    simulationStatus,
    liveStates,
    structuralVersion,
  } = useTwinStore();

  const [hierarchy, setHierarchy] = useState<CompanyHierarchy | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await digitalTwinApi.getCompanyHierarchy();
      setHierarchy(data);
      setError(null);
      setSelectedRegionId((prev) =>
        prev && data.regions.some((r) => r.id === prev) ? prev : null
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 8000);
    return () => window.clearInterval(id);
  }, [load, currentUser, structuralVersion]);

  const liveSummary = React.useMemo(() => {
    if (!hierarchy) return null;
    const machines: MachineSummary[] = hierarchy.regions.flatMap((r) =>
      r.factories.flatMap((f) => f.production_lines.flatMap((l) => l.machines))
    );
    let running = 0;
    let idle = 0;
    let fault = 0;
    let maintenance = 0;
    machines.forEach((m) => {
      const status = (liveStates[m.id] ?? m.state)?.status;
      if (status === "Running") running += 1;
      else if (status === "Idle") idle += 1;
      else if (status === "Fault") fault += 1;
      else if (status === "Maintenance") maintenance += 1;
    });
    return {
      totalMachines: machines.length,
      totalFactories: hierarchy.summary.total_factories,
      totalRegions: hierarchy.regions.length,
      overallOee: hierarchy.summary.overall_oee,
      pendingHandovers: hierarchy.summary.pending_handovers,
      running,
      idle,
      fault,
      maintenance,
      firstMachineId: machines[0]?.id ?? null,
    };
  }, [hierarchy, liveStates]);

  const isSupervisory =
    currentUser &&
    ["company_admin", "regional_manager", "factory_supervisor"].includes(currentUser.role);
  const canAccessCentralizedReports = Boolean(
    currentUser && ["company_admin", "regional_manager"].includes(currentUser.role)
  );

  const handoverTargetPath = liveSummary?.firstMachineId
    ? `/digital-twin/machine/${liveSummary.firstMachineId}/handover`
    : "/digital-twin/operator";

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#F1F6FD] text-[#14213D]">
      <AuthModal />

      {/* Sticky Industrial Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-[#DCE6F2] bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2563EB] text-white shadow-xs">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <span className="block text-sm font-extrabold tracking-tight text-[#14213D]">
                APEX PRECISION
              </span>
              <span className="hidden text-[10px] text-slate-500 sm:block">
                One Company. Three Regions. Connected Operations.
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-5 text-xs font-medium text-[#334155] lg:flex">
            <a href="#india-map-section" className="font-semibold text-[#2563EB]">
              India Map
            </a>
            <a href="#regions-section" className="hover:text-[#2563EB]">
              Regions
            </a>
            <a href="#hierarchy-section" className="hover:text-[#2563EB]">
              Company Tree
            </a>
            <Link to="/digital-twin" className="hover:text-[#2563EB]">
              Digital Twin
            </Link>
            <Link to="/digital-twin/analytics" className="hover:text-[#2563EB]">
              Analytics
            </Link>
            {canAccessCentralizedReports && (
              <Link to="/digital-twin/reports" className="hover:text-[#2563EB]">
                Reports
              </Link>
            )}
            {isSupervisory && (
              <Link to="/digital-twin/users" className="inline-flex items-center gap-1 hover:text-[#2563EB]">
                <Users className="h-3.5 w-3.5" />
                Operators & Users
              </Link>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {currentUser && (
              <Link
                to="/digital-twin/operator"
                className="hidden items-center gap-1 rounded-md border border-[#DCE6F2] bg-[#F1F6FD] px-2.5 py-1.5 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC] sm:inline-flex"
              >
                <Wrench className="h-3.5 w-3.5 text-[#2563EB]" />
                My Machines
              </Link>
            )}
            <Link
              to="/digital-twin"
              className="rounded-md bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
            >
              Explore Digital Twin
            </Link>
            {currentUser ? (
              <button
                type="button"
                onClick={logoutUser}
                className="rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#14213D] hover:bg-[#F1F6FD]"
              >
                {currentUser.name.split(" (")[0]} • Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#14213D] hover:bg-[#F1F6FD]"
              >
                <LogIn className="h-3.5 w-3.5 text-[#2563EB]" />
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-12 px-4 pb-16 pt-8 sm:px-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            Unable to load live industrial operations data: {error}
          </div>
        )}

        {/* ===================================================================
            SECTION 1 — Hero / Company Introduction
           =================================================================== */}
        <section className="rounded-2xl border border-[#DCE6F2] bg-white px-6 py-10 text-center shadow-xs sm:px-10">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[#DCE6F2] bg-[#EAF2FC] px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#2563EB]">
            <Radio
              className={`h-3.5 w-3.5 ${
                simulationStatus?.running ? "animate-pulse text-[#2563EB]" : "text-[#2563EB]"
              }`}
            />
            <span>PS-032 | Paperless Digital Shift Data Management System</span>
          </div>

          <h1 className="mx-auto mt-4 max-w-3xl text-3xl font-extrabold tracking-tight text-[#14213D] sm:text-5xl">
            Apex Precision <span className="text-[#2563EB]">Manufacturing</span>
          </h1>

          <p className="mx-auto mt-2.5 max-w-2xl text-base font-medium text-[#334155] sm:text-lg">
            One Company. Three Regions. Connected Operations.
          </p>

          {/* Key System Pillars */}
          <div className="mx-auto mt-6 grid max-w-4xl grid-cols-1 gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              "Industrial Digital Twin",
              "Smart Shift Handover",
              "Real-time factory visibility",
              "Paperless production and operational records",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] px-3.5 py-2.5 text-xs font-semibold text-[#14213D]"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2563EB]" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* Primary Actions */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/digital-twin")}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 sm:text-sm"
            >
              Explore Digital Twin
              <ArrowRight className="h-4 w-4" />
            </button>
            {canAccessCentralizedReports ? (
              <Link
                to="/digital-twin/reports"
                className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-white px-5 py-2.5 text-xs font-semibold text-[#14213D] transition hover:bg-[#EAF2FC] sm:text-sm"
              >
                <FileSpreadsheet className="h-4 w-4 text-[#2563EB]" />
                View Reports
              </Link>
            ) : currentUser ? (
              <Link
                to="/digital-twin/my-reports"
                className="inline-flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-white px-5 py-2.5 text-xs font-semibold text-[#14213D] transition hover:bg-[#EAF2FC] sm:text-sm"
              >
                <FileSpreadsheet className="h-4 w-4 text-[#2563EB]" />
                My Shift Logs
              </Link>
            ) : null}
          </div>

          {/* Live Simulated Telemetry Operational Strip */}
          <div className="mx-auto mt-6 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] px-5 py-2.5 text-xs">
            <span className="font-mono text-[#334155]">
              OEE <strong className="text-[#2563EB]">{liveSummary?.overallOee ?? 0}%</strong>
            </span>
            <span className="font-mono text-emerald-700">
              ● Running <strong>{liveSummary?.running ?? 0}</strong>
            </span>
            <span className="font-mono text-amber-700">
              ● Idle <strong>{liveSummary?.idle ?? 0}</strong>
            </span>
            <span className="font-mono text-red-700">
              ● Fault <strong>{liveSummary?.fault ?? 0}</strong>
            </span>
            <span className="font-mono text-sky-700">
              ● Maintenance <strong>{liveSummary?.maintenance ?? 0}</strong>
            </span>
            <span className="border-l border-[#DCE6F2] pl-4 font-mono text-[10px] font-semibold uppercase text-slate-500">
              {simulationStatus?.running
                ? `Simulated Telemetry Active (#${simulationStatus.ticks_emitted})`
                : "Simulated Telemetry"}
            </span>
          </div>
        </section>

        {/* ===================================================================
            SECTION 2 — Real Geographic Map (Full-Width, Reasonable Height)
           =================================================================== */}
        <section id="india-map-section" className="scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                Geographic Footprint
              </span>
              <h2 className="text-xl font-bold text-[#14213D]">
                India Operations Map
              </h2>
              <p className="text-xs text-[#334155]">
                Pan, zoom, or click any factory pin to inspect live status and open its Factory Digital Twin.
              </p>
            </div>
          </div>

          <div className="h-[460px] w-full overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-xs lg:h-[520px]">
            <IndustrialNetworkMap
              hierarchy={hierarchy}
              liveStates={liveStates}
              selectedRegionId={selectedRegionId}
              onSelectRegion={setSelectedRegionId}
            />
          </div>
        </section>

        {/* ===================================================================
            SECTION 3 — Three Region Cards Below the Map
           =================================================================== */}
        <section id="regions-section" className="scroll-mt-20">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                Regional Operations
              </span>
              <h2 className="text-xl font-bold text-[#14213D]">
                Three Regions. Connected Manufacturing Plants.
              </h2>
              <p className="text-xs text-[#334155]">
                Select any region to inspect its hierarchy view, or click a factory directly.
              </p>
            </div>
          </div>

          {loading && !hierarchy ? (
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-8 text-center text-xs text-slate-500">
              Loading regional operations…
            </div>
          ) : hierarchy && hierarchy.regions.length === 0 ? (
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-6 text-center text-xs text-[#334155]">
              No regions or machines available for your active role scope.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {hierarchy?.regions.map((region) => {
                const regMachines = region.factories.flatMap((f) =>
                  f.production_lines.flatMap((l) => l.machines)
                );
                const regRunning = regMachines.filter(
                  (m) => (liveStates[m.id] ?? m.state)?.status === "Running"
                ).length;
                const regFaults = regMachines.filter(
                  (m) => (liveStates[m.id] ?? m.state)?.status === "Fault"
                ).length;
                const isSelected = selectedRegionId === region.id;

                return (
                  <div
                    key={region.id}
                    onClick={() => navigate(`/digital-twin/region/${region.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/digital-twin/region/${region.id}`);
                      }
                    }}
                    className={`flex cursor-pointer flex-col justify-between rounded-2xl border bg-white p-5 transition ${
                      isSelected
                        ? "border-[#2563EB] shadow-md ring-2 ring-blue-100"
                        : "border-[#DCE6F2] shadow-2xs hover:border-[#2563EB]"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                            {region.code}
                          </span>
                          <h3 className="mt-0.5 text-base font-bold text-[#14213D]">
                            {region.name}
                          </h3>
                        </div>
                        <Globe2 className="h-5 w-5 text-[#2563EB]" />
                      </div>

                      <p className="mt-1.5 text-xs text-[#334155]">
                        {region.description ?? "Connected precision manufacturing operations."}
                      </p>

                      {/* Region Operational Metrics */}
                      <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-2.5 text-center font-mono text-xs">
                        <div>
                          <div className="text-[10px] text-slate-500">Factories</div>
                          <div className="font-bold text-[#14213D]">{region.factories.length}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Machines</div>
                          <div className="font-bold text-[#14213D]">{regMachines.length}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Running</div>
                          <div className="font-bold text-emerald-700">{regRunning}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Faults</div>
                          <div
                            className={`font-bold ${
                              regFaults > 0 ? "text-red-600" : "text-emerald-700"
                            }`}
                          >
                            {regFaults}
                          </div>
                        </div>
                      </div>

                      {/* Unique Authorized Factories */}
                      <div className="mt-4 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Factories
                        </div>
                        {region.factories.map((fac) => (
                          <button
                            key={fac.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/digital-twin/factory/${fac.id}`);
                            }}
                            className="flex w-full items-center justify-between rounded-lg border border-[#DCE6F2] bg-white px-3 py-2 text-left text-xs transition hover:border-[#2563EB] hover:bg-[#EAF2FC]/50"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Factory className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                              <span className="truncate font-semibold text-[#14213D]">
                                {fac.name}
                              </span>
                            </span>
                            <span className="ml-2 shrink-0 font-mono text-[10px] text-slate-500">
                              {fac.summary.total_machines}M • {fac.summary.overall_oee}%
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#DCE6F2] bg-[#EAF2FC] px-3 py-2 text-xs font-semibold text-[#2563EB]">
                      Open {region.name} View
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ===================================================================
            SECTION 4 — Company Hierarchy Tree
           =================================================================== */}
        <section id="hierarchy-section" className="scroll-mt-20">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                Enterprise Structure
              </span>
              <h2 className="text-xl font-bold text-[#14213D]">Company Hierarchy Tree</h2>
              <p className="text-xs text-[#334155]">
                Expand Company → Region → Factory → Production Line → Machine to jump directly into Digital Twin inspection.
              </p>
            </div>
            <Link
              to="/digital-twin"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
            >
              Open Full 3D Hierarchy Workspace
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="h-[460px] w-full overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-xs">
            <HierarchyTreeSidebar embedded />
          </div>
        </section>

        {/* ===================================================================
            SECTION 5 — Industrial Digital Twin Overview
           =================================================================== */}
        <section id="digital-twin-overview" className="scroll-mt-20">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                Digital Twin Capabilities
              </span>
              <h2 className="text-xl font-bold text-[#14213D]">
                Industrial Digital Twin Overview
              </h2>
              <p className="text-xs text-[#334155]">
                Integrated operational intelligence synced across live machine state, quality, energy, and asset passports.
              </p>
            </div>
            <Link
              to="/digital-twin/analytics"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
            >
              Open Performance Analytics
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DIGITAL_TWIN_CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.title}
                  className="rounded-2xl border border-[#DCE6F2] bg-white p-4 shadow-2xs transition hover:border-[#2563EB]"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF2FC] text-[#2563EB]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-bold text-[#14213D]">{cap.title}</h3>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#334155]">{cap.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ===================================================================
            SECTION 6 — Smart Shift Handover
           =================================================================== */}
        <section
          id="shift-handover-section"
          className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-xs sm:p-8"
        >
          <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                Paperless Continuity
              </span>
              <h2 className="mt-1 text-xl font-bold text-[#14213D]">Smart Shift Handover</h2>
              <p className="mt-2 text-xs leading-relaxed text-[#334155] sm:text-sm">
                Eliminate paper registers between shifts with grounded machine-wise handover notes, mandatory incoming sign-off, and permanent audit logs.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  "Outgoing shift records",
                  "Production summary",
                  "Abnormalities and blockers",
                  "Maintenance updates",
                  "Incoming shift acknowledgement",
                  "Traceable audit history",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] px-3 py-2 text-xs font-medium text-[#14213D]"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-5 lg:col-span-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#2563EB]">
                  Live Handover Queue
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-extrabold text-[#14213D]">
                    {liveSummary?.pendingHandovers ?? 0}
                  </span>
                  <span className="text-xs font-medium text-[#334155]">
                    pending handover(s) awaiting acknowledgement
                  </span>
                </div>
                <p className="mt-2 text-xs text-[#334155]">
                  Every shift transition automatically compiles machine output, active faults, maintenance actions, and PDF handover sign-off records.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate(handoverTargetPath)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Open Handover Module
                  <ArrowRight className="h-4 w-4" />
                </button>
                <Link
                  to="/digital-twin/events"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCE6F2] bg-white px-4 py-2.5 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
                >
                  <Activity className="h-3.5 w-3.5 text-[#2563EB]" />
                  Audit Trail
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ===================================================================
            SECTION 7 — Centralized Reports (Shown only to Company Admin & Regional Manager)
           =================================================================== */}
        {canAccessCentralizedReports && (
          <section
            id="centralized-reports-section"
            className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-xs sm:p-8"
          >
            <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                  Unified Compliance & Downloads
                </span>
                <h2 className="mt-1 text-xl font-bold text-[#14213D]">Centralized Reports</h2>
                <p className="mt-2 text-xs leading-relaxed text-[#334155] sm:text-sm">
                  Filter operational records across Company → Region → Factory → Production Line → Machine and export formatted documents in one click.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    "Region-wise reports",
                    "Factory-wise reports",
                    "Production reports",
                    "Maintenance reports",
                    "Shift handover reports",
                    "PDF and ZIP downloads",
                  ].map((label) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] px-3 py-2 text-xs font-medium text-[#14213D]"
                    >
                      {label.includes("ZIP") ? (
                        <Download className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
                      )}
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-start justify-center rounded-xl border border-[#DCE6F2] bg-[#EAF2FC] p-5 lg:col-span-4">
                <BarChart3 className="h-7 w-7 text-[#2563EB]" />
                <h3 className="mt-2 text-sm font-bold text-[#14213D]">
                  Filter, Preview & Export
                </h3>
                <p className="mt-1 text-xs text-[#334155]">
                  Access authorized operational PDFs and bulk bundles across your authorized scope.
                </p>
                <Link
                  to="/digital-twin/reports"
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Open Centralized Reports
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
