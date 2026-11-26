import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ClipboardList,
  Cpu,
  FileSpreadsheet,
  Home,
  Layers,
  LogIn,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PlayCircle,
  Radio,
  TableProperties,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import { AuthModal } from "../ui/AuthModal";
import { HierarchyTreeSidebar } from "../ui/HierarchyTreeSidebar";
import { useTwinStore } from "../../store/twinStore";

interface AppShellProps {
  breadcrumbs: BreadcrumbItem[];
  title: string;
  subtitle?: string;
  showOverviewToggle?: boolean;
  showHierarchyTree?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  breadcrumbs,
  title,
  subtitle,
  showOverviewToggle = true,
  showHierarchyTree,
  actions,
  children,
}) => {
  const {
    wsStatus,
    lastSyncAt,
    simulationStatus,
    overviewMode,
    setOverviewMode,
    currentUser,
    setAuthModalOpen,
    logoutUser,
  } = useTwinStore();
  const location = useLocation();
  const isTwinTreeRoute =
    showHierarchyTree ?? /^\/digital-twin(\/(region|factory|line|machine)(\/|$).*)?$/.test(location.pathname);
  const [desktopTreeOpen, setDesktopTreeOpen] = useState(true);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  const syncLabel =
    wsStatus === "connected"
      ? "Live Sync"
      : wsStatus === "connecting"
        ? "Connecting…"
        : "Disconnected";

  const syncDot =
    wsStatus === "connected"
      ? "bg-emerald-600"
      : wsStatus === "connecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-red-600";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <AuthModal />

      {/* Top Industrial Control Header */}
      <header className="z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] bg-white px-4 py-2.5 shadow-2xs">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-700 text-white">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-slate-900">APEX DIGITAL TWIN</span>
                <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                  PS-032
                </span>
              </div>
              <p className="text-[11px] text-slate-500">One Company. Three Regions. Connected Operations.</p>
            </div>
          </Link>

          <div className="hidden h-7 w-px bg-slate-200 md:block" />
          <div className="hidden xl:block">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/digital-twin/simulation"
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-semibold transition ${
              simulationStatus?.running
                ? "border-blue-300 bg-blue-50 text-blue-800"
                : simulationStatus?.paused
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
            title="Simulation Mode Status"
          >
            <Radio
              className={`h-3.5 w-3.5 ${
                simulationStatus?.running
                  ? "animate-pulse text-blue-700"
                  : simulationStatus?.paused
                    ? "text-amber-600"
                    : "text-slate-500"
              }`}
            />
            <span>
              SIM •{" "}
              {simulationStatus?.running
                ? `RUNNING (#${simulationStatus.ticks_emitted})`
                : simulationStatus?.paused
                  ? `PAUSED (#${simulationStatus.ticks_emitted})`
                  : "STOPPED"}
            </span>
          </Link>

          <div className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
            <span className={`h-2 w-2 rounded-full ${syncDot}`} />
            <span>{syncLabel}</span>
            {lastSyncAt && (
              <span className="hidden font-mono text-[10px] text-slate-400 sm:inline">
                {new Date(lastSyncAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {showOverviewToggle && (
            <button
              type="button"
              onClick={() => setOverviewMode(!overviewMode)}
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                overviewMode
                  ? "border-blue-600 bg-blue-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {overviewMode ? <Layers className="h-3.5 w-3.5" /> : <TableProperties className="h-3.5 w-3.5" />}
              <span>{overviewMode ? "3D View" : "Overview"}</span>
            </button>
          )}

          <Link
            to="/digital-twin/simulation"
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
              location.pathname === "/digital-twin/simulation"
                ? "border-blue-700 bg-blue-50 text-blue-800"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            <span>Simulation</span>
          </Link>

          <Link
            to="/digital-twin/events"
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
              location.pathname === "/digital-twin/events"
                ? "border-blue-700 bg-blue-50 text-blue-800"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Events & Audit</span>
          </Link>

          {currentUser && (
            <>
              <Link
                to="/digital-twin/operator"
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                  location.pathname === "/digital-twin/operator"
                    ? "border-blue-700 bg-blue-50 text-blue-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>My Machines</span>
              </Link>
              <Link
                to="/digital-twin/my-reports"
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                  location.pathname === "/digital-twin/my-reports"
                    ? "border-blue-700 bg-blue-50 text-blue-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                <span>My Reports</span>
              </Link>
              <Link
                to="/digital-twin/analytics"
                className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                  location.pathname === "/digital-twin/analytics"
                    ? "border-blue-700 bg-blue-50 text-blue-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>Analytics</span>
              </Link>
              {["company_admin", "regional_manager"].includes(currentUser.role) && (
                <Link
                  to="/digital-twin/reports"
                  className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                    location.pathname === "/digital-twin/reports"
                      ? "border-[#93C5FD] bg-[#DBEAFE] text-[#14213D]"
                      : "border-[#DCE6F2] bg-white text-[#334155] hover:bg-[#E3EEFF]"
                  }`}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-[#2563EB]" />
                  <span>Reports</span>
                </Link>
              )}
            </>
          )}

          {currentUser && ["company_admin", "regional_manager", "factory_supervisor"].includes(currentUser.role) && (
            <Link
              to="/digital-twin/users"
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition ${
                location.pathname === "/digital-twin/users"
                  ? "border-blue-700 bg-blue-50 text-blue-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Users & Access</span>
            </Link>
          )}

          {/* Operator / Role Sign-In Control */}
          {currentUser ? (
            <div className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs">
              <UserCheck className="h-3.5 w-3.5 text-blue-700" />
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="font-semibold text-blue-900 hover:underline"
                title="Switch Operator / Role"
              >
                {currentUser.name.split(" (")[0]}
              </button>
              <span className="rounded bg-white px-1 py-0.5 font-mono text-[10px] text-blue-700">
                {currentUser.role}
              </span>
              <button
                type="button"
                onClick={logoutUser}
                className="ml-1 text-slate-500 hover:text-red-600"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Operator Sign-In</span>
            </button>
          )}
        </div>
      </header>

      {/* Secondary Context Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-2">
        <div className="flex items-center gap-2.5">
          {isTwinTreeRoute && (
            <>
              <button
                type="button"
                onClick={() => setDesktopTreeOpen((v) => !v)}
                className="hidden items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 lg:inline-flex"
                title={desktopTreeOpen ? "Collapse Hierarchy Tree" : "Expand Hierarchy Tree"}
              >
                {desktopTreeOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
                <span>{desktopTreeOpen ? "Hide Tree" : "Show Tree"}</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileTreeOpen(true)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 lg:hidden"
              >
                <PanelLeftOpen className="h-3.5 w-3.5" />
                <span>Hierarchy</span>
              </button>
            </>
          )}
          <div>
            <div className="mb-1 xl:hidden">
              <Breadcrumbs items={breadcrumbs} />
            </div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h1 className="text-base font-bold text-slate-900">{title}</h1>
              {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <Home className="h-3.5 w-3.5 text-slate-500" />
            <span className="hidden sm:inline">Company Portal</span>
          </Link>
          {actions}
        </div>
      </div>

      {/* Main Workspace with Synchronized Collapsible Tree Navigation */}
      <div className="relative flex flex-1 overflow-hidden">
        {isTwinTreeRoute && desktopTreeOpen && (
          <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white lg:block">
            <HierarchyTreeSidebar />
          </aside>
        )}

        {isTwinTreeRoute && mobileTreeOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div className="h-full w-80 max-w-[85vw] border-r border-[#DCE6F2] bg-white shadow-xl">
              <HierarchyTreeSidebar onNavigate={() => setMobileTreeOpen(false)} />
            </div>
            <button
              type="button"
              aria-label="Close Hierarchy Drawer"
              onClick={() => setMobileTreeOpen(false)}
              className="flex-1 bg-[#14213D]/30 backdrop-blur-xs"
            />
          </div>
        )}

        <main className="relative flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
};
