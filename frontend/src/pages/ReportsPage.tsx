import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  Calendar,
  Download,
  Eye,
  FileDown,
  FileText,
  Filter,
  LogIn,
  Printer,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type {
  CentralizedReportItem,
  CentralizedReportPreview,
  CentralizedReportsSummary,
  CompanyHierarchy,
} from "../types/digitalTwin";

const CATEGORIES = [
  { value: "", label: "All Categories" },
  { value: "shift_handover", label: "Shift Handover Reports" },
  { value: "production", label: "Production Reports" },
  { value: "abnormality", label: "Abnormality & Fault Reports" },
  { value: "maintenance", label: "Maintenance Reports" },
  { value: "safety_checklist", label: "Safety Checklist Reports" },
  { value: "quality", label: "Quality & Defect Reports" },
  { value: "cleaning_5s", label: "5S & Cleaning Reports" },
  { value: "machine_oee", label: "Machine Performance & OEE" },
  { value: "audit", label: "Audit Trail Reports" },
];

const STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "passed", label: "Passed" },
  { value: "critical_fail", label: "Critical Fail" },
  { value: "verified", label: "Verified" },
  { value: "on_target", label: "On Target" },
  { value: "below_target", label: "Below Target" },
];

export const ReportsPage: React.FC = () => {
  const { currentUser, setAuthModalOpen } = useTwinStore();
  const [hierarchy, setHierarchy] = useState<CompanyHierarchy | null>(null);
  const [reports, setReports] = useState<CentralizedReportItem[]>([]);
  const [summary, setSummary] = useState<CentralizedReportsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDownload, setBusyDownload] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Filters
  const [regionId, setRegionId] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [lineId, setLineId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [shiftName, setShiftName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [datePreset, setDatePreset] = useState<"all" | "today" | "7d" | "month" | "custom">("all");

  // Preview Modal
  const [previewData, setPreviewData] = useState<CentralizedReportPreview | null>(null);

  const isCompanyAdmin = currentUser?.role === "company_admin";
  const isRegionalManager = currentUser?.role === "regional_manager";
  const canAccessCentralizedReports = Boolean(isCompanyAdmin || isRegionalManager);

  // Lock Regional Manager filter strictly to assigned region
  useEffect(() => {
    if (isRegionalManager && currentUser?.assigned_region_id) {
      setRegionId(currentUser.assigned_region_id);
    }
  }, [isRegionalManager, currentUser?.assigned_region_id]);

  const loadHierarchyAndReports = useCallback(async () => {
    if (!currentUser || !canAccessCentralizedReports) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const effectiveRegion = isRegionalManager
        ? currentUser.assigned_region_id || undefined
        : regionId || undefined;
      const [h, repRes] = await Promise.all([
        digitalTwinApi.getCompanyHierarchy(),
        digitalTwinApi.listCentralizedReports({
          region_id: effectiveRegion,
          factory_id: factoryId || undefined,
          line_id: lineId || undefined,
          machine_id: machineId || undefined,
          category: category || undefined,
          status: status || undefined,
          shift_name: shiftName || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        }),
      ]);
      setHierarchy(h);
      setReports(repRes.reports);
      setSummary(repRes.summary);
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, canAccessCentralizedReports, isRegionalManager, regionId, factoryId, lineId, machineId, category, status, shiftName, startDate, endDate]);

  useEffect(() => {
    loadHierarchyAndReports();
  }, [loadHierarchyAndReports]);

  const applyPreset = (preset: "all" | "today" | "7d" | "month") => {
    setDatePreset(preset);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === "all") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "today") {
      const t = fmt(now);
      setStartDate(t);
      setEndDate(t);
    } else if (preset === "7d") {
      const past = new Date(now.getTime() - 6 * 86400000);
      setStartDate(fmt(past));
      setEndDate(fmt(now));
    } else if (preset === "month") {
      const startM = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(fmt(startM));
      setEndDate(fmt(now));
    }
  };

  // Cascading hierarchy dropdown options strictly from backend hierarchy
  const regions = hierarchy?.regions ?? [];
  const factories = regions
    .filter((r) => !regionId || r.id === regionId)
    .flatMap((r) => r.factories);
  const lines = factories
    .filter((f) => !factoryId || f.id === factoryId)
    .flatMap((f) => f.production_lines);
  const machines = lines
    .filter((l) => !lineId || l.id === lineId)
    .flatMap((l) => l.machines);

  const openPreview = async (uid: string) => {
    setNotice(null);
    try {
      const data = await digitalTwinApi.previewCentralizedReport(uid);
      setPreviewData(data);
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    }
  };

  const downloadSingle = async (uid: string) => {
    setBusyDownload(true);
    setNotice(null);
    try {
      await digitalTwinApi.downloadFile(
        `/api/ps032/reports/download/${encodeURIComponent(uid)}`,
        `${uid.replace(":", "_")}.pdf`
      );
      setNotice({ type: "ok", text: "Individual PDF downloaded and logged to audit trail." });
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusyDownload(false);
    }
  };

  const determineBulkScope = (): "factory" | "region" | "company" | null => {
    if (!currentUser) return null;
    if (currentUser.role === "regional_manager") return factoryId ? "factory" : "region";
    if (currentUser.role === "company_admin") {
      if (factoryId) return "factory";
      if (regionId) return "region";
      return "company";
    }
    return null;
  };

  const bulkScope = determineBulkScope();

  const triggerBulkDownload = async (scope: "factory" | "region" | "company", format: "pdf" | "zip") => {
    setBusyDownload(true);
    setNotice(null);
    try {
      const q = new URLSearchParams();
      q.set("scope", scope);
      q.set("format", format);
      const effRegionId = regionId || currentUser?.assigned_region_id || "";
      const effFactoryId = factoryId || currentUser?.assigned_factory_id || "";
      if (scope !== "company" && effRegionId) q.set("region_id", effRegionId);
      if (scope === "factory" && effFactoryId) q.set("factory_id", effFactoryId);
      if (lineId) q.set("line_id", lineId);
      if (machineId) q.set("machine_id", machineId);
      if (category) q.set("category", category);
      if (status) q.set("status", status);
      if (shiftName) q.set("shift_name", shiftName);
      if (startDate) q.set("start_date", startDate);
      if (endDate) q.set("end_date", endDate);

      await digitalTwinApi.downloadFile(
        `/api/ps032/reports/bulk-download?${q.toString()}`,
        `PS032_${scope}_reports.${format}`
      );
      setNotice({
        type: "ok",
        text: `Consolidated ${scope} ${format.toUpperCase()} export downloaded and audited.`,
      });
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusyDownload(false);
    }
  };

  const bulkButtonLabel =
    bulkScope === "factory"
      ? "Download Factory Report (PDF)"
      : bulkScope === "region"
        ? "Download Region Report (PDF)"
        : "Download Company Report (PDF)";

  return (
    <AppShell
      breadcrumbs={[
        { label: "Centralized Factory Reports" },
      ]}
      title="Centralized Factory Reports"
      subtitle="View, filter, and download operational reports across your organization."
      showOverviewToggle={false}
      actions={
        <button
          type="button"
          onClick={loadHierarchyAndReports}
          className="inline-flex items-center gap-1.5 rounded border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#E3EEFF]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      <div className="h-full overflow-y-auto bg-[#F1F6FD] p-5">
        {!currentUser ? (
          <div className="mx-auto max-w-md rounded-xl border border-[#DCE6F2] bg-white p-8 text-center shadow-xs">
            <ShieldAlert className="mx-auto h-10 w-10 text-[#2563EB]" />
            <h2 className="mt-3 text-base font-bold text-[#14213D]">Sign In Required</h2>
            <p className="mt-1 text-xs text-[#64748B]">
              Centralized factory reports enforce strict company, regional, factory, and operator machine permissions.
            </p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </button>
          </div>
        ) : !canAccessCentralizedReports ? (
          <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-8 text-center shadow-xs">
            <ShieldAlert className="mx-auto h-10 w-10 text-red-600" />
            <h2 className="mt-3 text-base font-bold text-[#14213D]">
              Access Denied — Centralized Reports Restricted
            </h2>
            <p className="mt-1.5 text-xs text-[#334155]">
              Centralized Factory Reports are authorized exclusively for <strong>Company Admin</strong> and{" "}
              <strong>Regional Manager</strong> roles. Your current role (
              <span className="font-mono font-semibold text-[#14213D]">{currentUser.role}</span>) does not permit access to organization-wide report exports.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link
                to="/digital-twin/operator"
                className="rounded-md bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
              >
                Open My Machines Dashboard
              </Link>
              <Link
                to="/digital-twin/my-reports"
                className="rounded-md border border-[#DCE6F2] bg-[#F1F6FD] px-4 py-2 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
              >
                My Shift Reports
              </Link>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-5">
            {notice && (
              <div
                className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
                  notice.type === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {notice.text}
              </div>
            )}

            {/* Summary KPI Strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Total Reports", value: summary?.total_reports ?? 0, tone: "text-[#14213D]" },
                { label: "Pending Handovers", value: summary?.pending_handovers ?? 0, tone: "text-amber-700" },
                { label: "Ack Handovers", value: summary?.acknowledged_handovers ?? 0, tone: "text-emerald-700" },
                { label: "Open Abnormalities", value: summary?.open_abnormalities ?? 0, tone: "text-red-700" },
                { label: "Maintenance", value: summary?.maintenance_reports ?? 0, tone: "text-[#2563EB]" },
                { label: "Factories Covered", value: summary?.factories_covered ?? 0, tone: "text-[#14213D]" },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-[#DCE6F2] bg-white px-4 py-3 shadow-2xs"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    {card.label}
                  </div>
                  <div className={`mt-1 font-mono text-2xl font-bold ${card.tone}`}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* Cascading Hierarchy, Category, Shift & Date Filters + One-Click Bulk Actions */}
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-4 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                  <Filter className="h-4 w-4 text-[#2563EB]" />
                  <span>Hierarchical & Operational Report Filters</span>
                </div>

                {/* Quick Date Presets */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Calendar className="h-3.5 w-3.5 text-[#64748B]" />
                  {[
                    { id: "all" as const, label: "All Dates" },
                    { id: "today" as const, label: "Today" },
                    { id: "7d" as const, label: "Last 7 Days" },
                    { id: "month" as const, label: "This Month" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                        datePreset === p.id
                          ? "border-[#93C5FD] bg-[#DBEAFE] text-[#14213D]"
                          : "border-[#DCE6F2] bg-[#EAF2FC] text-[#334155] hover:bg-[#E3EEFF]"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  aria-label="Filter Region"
                  value={isRegionalManager ? currentUser?.assigned_region_id ?? regionId : regionId}
                  disabled={isRegionalManager}
                  onChange={(e) => {
                    if (isRegionalManager) return;
                    setRegionId(e.target.value);
                    setFactoryId("");
                    setLineId("");
                    setMachineId("");
                  }}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155] disabled:bg-[#F1F6FD]"
                >
                  {isCompanyAdmin && <option value="">All Regions</option>}
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Factory"
                  value={factoryId}
                  onChange={(e) => {
                    setFactoryId(e.target.value);
                    setLineId("");
                    setMachineId("");
                  }}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  <option value="">
                    {currentUser.role === "company_admin" ? "All Factories" : "Permitted Factories"}
                  </option>
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Production Line"
                  value={lineId}
                  onChange={(e) => {
                    setLineId(e.target.value);
                    setMachineId("");
                  }}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  <option value="">All Production Lines</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Machine"
                  value={machineId}
                  onChange={(e) => setMachineId(e.target.value)}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  <option value="">All Machines</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter Shift"
                  value={shiftName}
                  onChange={(e) => setShiftName(e.target.value)}
                  className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#334155]"
                >
                  <option value="">All Shifts</option>
                  <option value="Morning Shift">Morning Shift</option>
                  <option value="Evening Shift">Evening Shift</option>
                  <option value="Night Shift">Night Shift</option>
                  <option value="Frühschicht (Early)">Frühschicht (Early)</option>
                  <option value="Nachtschicht (Night)">Nachtschicht (Night)</option>
                </select>

                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setDatePreset("custom");
                      setStartDate(e.target.value);
                    }}
                    className="w-1/2 rounded-md border border-[#DCE6F2] bg-white px-2 py-1.5 text-xs"
                    aria-label="Start Date"
                  />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setDatePreset("custom");
                      setEndDate(e.target.value);
                    }}
                    className="w-1/2 rounded-md border border-[#DCE6F2] bg-white px-2 py-1.5 text-xs"
                    aria-label="End Date"
                  />
                </div>
              </div>

              {/* Bulk One-Click Download Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DCE6F2] bg-[#EAF2FC] rounded-lg px-3.5 py-2.5">
                <div className="text-xs text-[#334155]">
                  Showing <strong className="text-[#14213D]">{reports.length}</strong> authorized report(s)
                  {bulkScope ? (
                    <span className="ml-1 text-[#64748B]">
                      • Active Bulk Scope: <strong className="uppercase text-[#2563EB]">{bulkScope}</strong>
                    </span>
                  ) : (
                    <span className="ml-1 text-[#64748B]">• Individual machine report downloads enabled</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {bulkScope && (
                    <>
                      <button
                        type="button"
                        disabled={busyDownload || reports.length === 0}
                        onClick={() => triggerBulkDownload(bulkScope, "pdf")}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#2563EB] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#1D4ED8] disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {bulkButtonLabel}
                      </button>
                      <button
                        type="button"
                        disabled={busyDownload || reports.length === 0}
                        onClick={() => triggerBulkDownload(bulkScope, "zip")}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#14213D] hover:bg-[#E3EEFF] disabled:opacity-40"
                      >
                        <Archive className="h-3.5 w-3.5 text-[#2563EB]" />
                        Export ZIP Bundle
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setRegionId(isRegionalManager ? currentUser?.assigned_region_id ?? "" : "");
                      setFactoryId("");
                      setLineId("");
                      setMachineId("");
                      setCategory("");
                      setStatus("");
                      setShiftName("");
                      applyPreset("all");
                    }}
                    className="rounded-md border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs font-medium text-[#64748B] hover:bg-[#E3EEFF]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Centralized Reports Table */}
            <div className="overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-2xs">
              {loading ? (
                <div className="p-10 text-center text-xs text-[#64748B]">Loading centralized reports…</div>
              ) : reports.length === 0 ? (
                <div className="p-10 text-center">
                  <FileText className="mx-auto h-8 w-8 text-[#64748B]" />
                  <h3 className="mt-2 text-sm font-bold text-[#14213D]">No reports available</h3>
                  <p className="mt-1 text-xs text-[#64748B]">
                    No operational reports match the selected region, factory, date, shift, or category filters.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#DCE6F2] bg-[#EAF2FC] text-[11px] font-bold uppercase tracking-wider text-[#14213D]">
                      <tr>
                        <th className="px-4 py-3">Report Name</th>
                        <th className="px-3 py-3">Region</th>
                        <th className="px-3 py-3">Factory</th>
                        <th className="px-3 py-3">Production Line</th>
                        <th className="px-3 py-3">Machine</th>
                        <th className="px-3 py-3">Shift</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DCE6F2]">
                      {reports.map((r) => (
                        <tr key={r.report_uid} className="transition hover:bg-[#E3EEFF]/50">
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-[#14213D]">{r.title}</div>
                            <div className="text-[11px] text-[#64748B]">{r.category_label}</div>
                          </td>
                          <td className="px-3 py-2.5 text-[#334155]">{r.region_name}</td>
                          <td className="px-3 py-2.5 font-medium text-[#14213D]">{r.factory_name}</td>
                          <td className="px-3 py-2.5 text-[#334155]">{r.line_name}</td>
                          <td className="px-3 py-2.5 font-mono font-bold text-[#2563EB]">{r.machine_code}</td>
                          <td className="px-3 py-2.5 text-[#334155]">{r.shift_name}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-[#64748B]">
                            {new Date(r.recorded_at).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
                                r.status === "pending" || r.status === "open" || r.status === "critical_fail" || r.status === "fault"
                                  ? "bg-red-100 text-red-800"
                                  : r.status === "acknowledged" || r.status === "completed" || r.status === "resolved" || r.status === "passed" || r.status === "verified" || r.status === "on_target"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-[#DBEAFE] text-[#14213D]"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openPreview(r.report_uid)}
                                className="inline-flex items-center gap-1 rounded border border-[#DCE6F2] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#14213D] hover:bg-[#E3EEFF]"
                              >
                                <Eye className="h-3 w-3 text-[#2563EB]" />
                                View
                              </button>
                              <button
                                type="button"
                                disabled={busyDownload}
                                onClick={() => downloadSingle(r.report_uid)}
                                className="inline-flex items-center gap-1 rounded bg-[#2563EB] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40"
                              >
                                <FileDown className="h-3 w-3" />
                                PDF
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Print-Friendly Report Preview Modal */}
        {previewData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213D]/35 p-4 backdrop-blur-xs">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DCE6F2] bg-[#EAF2FC] px-5 py-3.5">
                <div>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2563EB]">
                    {previewData.report.category_label} • {previewData.report.report_uid}
                  </span>
                  <h3 className="text-base font-bold text-[#14213D]">{previewData.report.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1 rounded border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] hover:bg-[#E3EEFF]"
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSingle(previewData.report.report_uid)}
                    className="inline-flex items-center gap-1 rounded bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
                  >
                    <FileDown className="h-3.5 w-3.5" /> Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewData(null)}
                    className="rounded p-1 text-[#64748B] hover:bg-white hover:text-[#14213D]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
                {/* Metadata Grid */}
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-4 sm:grid-cols-2">
                  <div>
                    <span className="text-[#64748B]">Company:</span>{" "}
                    <strong className="text-[#14213D]">{previewData.report.company_name}</strong>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Region / Factory:</span>{" "}
                    <strong className="text-[#14213D]">
                      {previewData.report.region_name} / {previewData.report.factory_name}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Line / Machine:</span>{" "}
                    <strong className="text-[#14213D]">
                      {previewData.report.line_name} • {previewData.report.machine_code} ({previewData.report.machine_name})
                    </strong>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Shift & Date:</span>{" "}
                    <strong className="text-[#14213D]">
                      {previewData.report.shift_name} • {new Date(previewData.report.recorded_at).toLocaleString()}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Operator / Actor:</span>{" "}
                    <strong className="text-[#14213D]">{previewData.report.operator_or_actor}</strong>
                  </div>
                  <div>
                    <span className="text-[#64748B]">Supervisor / Owner:</span>{" "}
                    <strong className="text-[#14213D]">{previewData.report.supervisor_name}</strong>
                  </div>
                </div>

                {/* Operational Details Table */}
                <div>
                  <h4 className="mb-2 font-bold uppercase tracking-wider text-[#14213D]">Operational Data</h4>
                  <div className="overflow-hidden rounded-lg border border-[#DCE6F2]">
                    <table className="w-full text-left text-xs">
                      <tbody className="divide-y divide-[#DCE6F2]">
                        <tr className="bg-[#EAF2FC]">
                          <td className="w-48 px-3 py-2 font-semibold text-[#14213D]">Summary</td>
                          <td className="px-3 py-2 text-[#334155]">{previewData.report.summary_line}</td>
                        </tr>
                        {Object.entries(previewData.report.raw_details || {}).map(([k, v]) =>
                          v !== null && v !== undefined ? (
                            <tr key={k}>
                              <td className="w-48 bg-[#F1F6FD] px-3 py-2 font-medium capitalize text-[#64748B]">
                                {k.replace(/_/g, " ")}
                              </td>
                              <td className="px-3 py-2 font-mono text-[#14213D]">
                                {typeof v === "object" ? JSON.stringify(v) : String(v)}
                              </td>
                            </tr>
                          ) : null
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Related Production, Abnormalities, Maintenance & Handover Context */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-[#DCE6F2] p-3.5">
                    <h4 className="mb-2 font-bold uppercase text-[#14213D]">
                      Abnormalities ({previewData.context.abnormalities.length})
                    </h4>
                    {previewData.context.abnormalities.length === 0 ? (
                      <div className="text-[#64748B]">No recent abnormalities.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {previewData.context.abnormalities.map((a) => (
                          <div key={a.code} className="rounded bg-[#F1F6FD] p-2">
                            <span className="font-mono font-bold text-[#14213D]">{a.code}</span> • {a.title} ({a.status})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-[#DCE6F2] p-3.5">
                    <h4 className="mb-2 font-bold uppercase text-[#14213D]">
                      Maintenance & Handover
                    </h4>
                    {previewData.context.latest_handover && (
                      <div className="mb-2 rounded border border-[#DCE6F2] bg-[#EAF2FC] p-2">
                        Handover <strong className="font-mono">{previewData.context.latest_handover.id}</strong> •{" "}
                        {previewData.context.latest_handover.status.toUpperCase()}
                        {previewData.context.latest_handover.acknowledged_by
                          ? ` by ${previewData.context.latest_handover.acknowledged_by}`
                          : ""}
                      </div>
                    )}
                    {previewData.context.maintenance_records.length === 0 ? (
                      <div className="text-[#64748B]">No recent maintenance logs.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {previewData.context.maintenance_records.map((m, idx) => (
                          <div key={idx} className="rounded bg-[#F1F6FD] p-2">
                            <span className="font-semibold uppercase">{m.type}</span> • {m.summary} ({m.status})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Audit Trail */}
                {previewData.context.audit_events.length > 0 && (
                  <div className="rounded-lg border border-[#DCE6F2] p-3.5">
                    <h4 className="mb-2 font-bold uppercase text-[#14213D]">Recent Audit Events</h4>
                    <div className="space-y-1">
                      {previewData.context.audit_events.map((ev, i) => (
                        <div key={i} className="flex justify-between gap-2 rounded bg-[#F1F6FD] px-2.5 py-1.5">
                          <span>
                            <strong className="font-mono text-[#2563EB]">{ev.action}</strong> — {ev.details}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-[#64748B]">
                            {ev.actor_name ?? "System"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
