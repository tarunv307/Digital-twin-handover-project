import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Clock,
  Cpu,
  Factory,
  Filter,
  Globe2,
  LogIn,
  Search,
  User as UserIcon,
} from "lucide-react";
import { digitalTwinApi } from "../../services/api";
import { useTwinStore } from "../../store/twinStore";
import type {
  CompanyHierarchy,
  PersonnelDetail,
  PersonnelSummary,
} from "../../types/digitalTwin";
import { StatusBadge } from "./StatusBadge";

interface OperatorProfilePanelProps {
  hierarchy: CompanyHierarchy | null;
  lockedFactoryId?: string | null;
  selectedUserId: number | null;
  onSelectUser: (userId: number | null) => void;
  onSelectMachine: (machineId: string, factoryId?: string | null) => void;
  onSelectFactory?: (factoryId: string) => void;
  onBack?: () => void;
  showDirectoryFilters?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Company Admin",
  regional_manager: "Regional Manager",
  factory_supervisor: "Factory Supervisor",
  operator: "Operator",
  maintenance_engineer: "Maintenance Engineer",
};

export const OperatorProfilePanel: React.FC<OperatorProfilePanelProps> = ({
  hierarchy,
  lockedFactoryId = null,
  selectedUserId,
  onSelectUser,
  onSelectMachine,
  onSelectFactory,
  onBack,
  showDirectoryFilters = true,
}) => {
  const { currentUser, setAuthModalOpen } = useTwinStore();

  const [searchQ, setSearchQ] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState(lockedFactoryId ?? "");
  const [machineFilter, setMachineFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [list, setList] = useState<PersonnelSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [profile, setProfile] = useState<PersonnelDetail | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedFactoryId !== null) {
      setFactoryFilter(lockedFactoryId);
    }
  }, [lockedFactoryId]);

  const factoriesInScope = useMemo(() => {
    if (!hierarchy) return [];
    return hierarchy.regions
      .filter((r) => !regionFilter || r.id === regionFilter)
      .flatMap((r) => r.factories);
  }, [hierarchy, regionFilter]);

  const machinesInScope = useMemo(() => {
    const activeFacId = lockedFactoryId || factoryFilter;
    return factoriesInScope
      .filter((f) => !activeFacId || f.id === activeFacId)
      .flatMap((f) => f.production_lines.flatMap((l) => l.machines));
  }, [factoriesInScope, factoryFilter, lockedFactoryId]);

  const loadDirectory = useCallback(async () => {
    if (!currentUser) {
      setList([]);
      return;
    }
    setListLoading(true);
    try {
      const rows = await digitalTwinApi.listPersonnel({
        q: searchQ.trim() || undefined,
        region_id: regionFilter || undefined,
        factory_id: (lockedFactoryId || factoryFilter) || undefined,
        machine_id: machineFilter || undefined,
        role: roleFilter || undefined,
      });
      setList(rows);
      setListError(null);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setListLoading(false);
    }
  }, [currentUser, searchQ, regionFilter, factoryFilter, lockedFactoryId, machineFilter, roleFilter]);

  useEffect(() => {
    if (selectedUserId === null) {
      loadDirectory();
    }
  }, [selectedUserId, loadDirectory]);

  useEffect(() => {
    if (!currentUser || selectedUserId === null) {
      setProfile(null);
      return;
    }
    let active = true;
    setProfileLoading(true);
    setProfileError(null);
    digitalTwinApi
      .getPersonnelProfile(selectedUserId)
      .then((res) => {
        if (active) setProfile(res);
      })
      .catch((err) => {
        if (active) setProfileError((err as Error).message);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, selectedUserId]);

  if (!currentUser) {
    return (
      <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-5 text-center">
        <UserIcon className="mx-auto h-8 w-8 text-[#2563EB]" />
        <h4 className="mt-2 text-sm font-bold text-[#14213D]">Sign In Required for Personnel Details</h4>
        <p className="mt-1 text-xs text-[#334155]">
          Operator profiles, shift assignments, and equipment histories are protected by role-based access control.
        </p>
        <button
          type="button"
          onClick={() => setAuthModalOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign In
        </button>
      </div>
    );
  }

  // Individual Selected Operator/User Profile View
  if (selectedUserId !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-[#DCE6F2] pb-2.5">
          <button
            type="button"
            onClick={() => {
              onSelectUser(null);
              if (onBack) onBack();
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1 text-xs font-semibold text-[#14213D] hover:bg-[#EAF2FC]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#2563EB]" />
            Back to Operators
          </button>
          <span className="font-mono text-[10px] font-semibold uppercase text-slate-500">
            Individual Profile
          </span>
        </div>

        {profileLoading && (
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-4 text-xs text-[#334155]">
            Loading personnel profile…
          </div>
        )}

        {profileError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {profileError}
          </div>
        )}

        {profile && !profileLoading && (
          <>
            {/* Person Summary Card */}
            <div className="rounded-xl border border-[#DCE6F2] bg-[#F1F6FD] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-base font-bold text-[#14213D]">{profile.user.name}</h4>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded bg-[#2563EB] px-2 py-0.5 font-mono font-semibold text-white">
                      {profile.user.employee_id ?? "No Employee ID"}
                    </span>
                    <span className="rounded border border-[#DCE6F2] bg-white px-2 py-0.5 font-semibold text-[#14213D]">
                      {ROLE_LABELS[profile.user.role] ?? profile.user.role}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 font-semibold ${
                        profile.assignment_status === "Active"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {profile.assignment_status}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    <Globe2 className="h-3 w-3 text-[#2563EB]" /> Region
                  </div>
                  <div className="mt-0.5 font-semibold text-[#14213D]">
                    {profile.user.assigned_region_name ?? "Not assigned"}
                  </div>
                </div>
                <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    <Factory className="h-3 w-3 text-[#2563EB]" /> Factory
                  </div>
                  {profile.user.assigned_factory_id && onSelectFactory ? (
                    <button
                      type="button"
                      onClick={() => onSelectFactory(profile.user.assigned_factory_id!)}
                      className="mt-0.5 text-left font-semibold text-[#2563EB] hover:underline"
                    >
                      {profile.user.assigned_factory_name ?? profile.user.assigned_factory_id}
                    </button>
                  ) : (
                    <div className="mt-0.5 font-semibold text-[#14213D]">
                      {profile.user.assigned_factory_name ?? "Not assigned"}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    <Building2 className="h-3 w-3 text-[#2563EB]" /> Production Line(s)
                  </div>
                  <div className="mt-0.5 font-semibold text-[#14213D]">
                    {profile.assigned_lines.length > 0
                      ? profile.assigned_lines.map((l) => l.name).join(", ")
                      : "None assigned"}
                  </div>
                </div>
                <div className="rounded-lg border border-[#DCE6F2] bg-white p-2">
                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                    <Clock className="h-3 w-3 text-[#2563EB]" /> Current Shift
                  </div>
                  <div className="mt-0.5 font-semibold text-[#14213D]">
                    {profile.current_shift ?? "No active shift"}
                  </div>
                </div>
              </div>
            </div>

            {/* Assigned Machines */}
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <h5 className="text-xs font-bold uppercase tracking-wider text-[#14213D]">
                  Assigned Machine(s) ({profile.assigned_machines.length})
                </h5>
              </div>
              {profile.assigned_machines.length === 0 ? (
                <p className="text-xs text-slate-500">No active machine assignments within your scope.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.assigned_machines.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectMachine(m.id, m.factory_id)}
                      className="flex w-full items-center justify-between rounded-lg border border-[#DCE6F2] bg-[#F1F6FD]/60 px-2.5 py-2 text-left text-xs transition hover:border-[#2563EB] hover:bg-[#EAF2FC]"
                    >
                      <div>
                        <div className="font-semibold text-[#14213D]">
                          <span className="font-mono text-[#2563EB]">{m.code}</span> • {m.name}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {m.factory_name} • {m.line_name}
                          {m.shift_name ? ` • ${m.shift_name}` : ""}
                        </div>
                      </div>
                      <StatusBadge status={m.status as "Running"} size="sm" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Production Reports */}
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                Recent Production Reports ({profile.recent_production_reports.length})
              </h5>
              {profile.recent_production_reports.length === 0 ? (
                <p className="text-xs text-slate-500">No production entries recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.recent_production_reports.slice(0, 6).map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs"
                    >
                      <div>
                        <span className="font-mono font-semibold text-[#2563EB]">{p.machine_code}</span>{" "}
                        <span className="text-[#14213D]">({p.shift_name})</span>
                        <div className="text-[10px] text-slate-500">
                          {new Date(p.recorded_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px]">
                        <div className="font-bold text-[#14213D]">
                          {p.units_produced}/{p.target_units} pcs
                        </div>
                        <div className="text-slate-500">{p.reject_units} rej</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Abnormalities */}
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Recent Abnormalities ({profile.recent_abnormalities.length})
              </h5>
              {profile.recent_abnormalities.length === 0 ? (
                <p className="text-xs text-slate-500">No abnormalities linked to this person.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.recent_abnormalities.slice(0, 6).map((a) => (
                    <div key={a.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#14213D]">
                          <span className="font-mono text-[#2563EB]">{a.code}</span> {a.title}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                          {a.status}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        Severity: {a.severity} • {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Handover Records */}
            <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
              <h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                <ClipboardCheck className="h-3.5 w-3.5 text-[#2563EB]" />
                Handover Records ({profile.handover_records.length})
              </h5>
              {profile.handover_records.length === 0 ? (
                <p className="text-xs text-slate-500">No handover records found.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.handover_records.slice(0, 6).map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-xs">
                      <div>
                        <div className="font-mono font-semibold text-[#14213D]">{h.id}</div>
                        <div className="text-[10px] text-slate-500">
                          {h.previous_shift_name} → {h.incoming_shift_name}
                        </div>
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          h.status === "acknowledged"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {h.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit Trail (when authorized) */}
            {profile.audit_authorized && (
              <div className="rounded-xl border border-[#DCE6F2] bg-white p-3">
                <h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#14213D]">
                  <Activity className="h-3.5 w-3.5 text-[#2563EB]" />
                  Recent Activity & Audit ({profile.recent_audit_events.length})
                </h5>
                {profile.recent_audit_events.length === 0 ? (
                  <p className="text-xs text-slate-500">No recent audit events recorded.</p>
                ) : (
                  <div className="space-y-1.5">
                    {profile.recent_audit_events.slice(0, 8).map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-[#DCE6F2] px-2.5 py-1.5 text-[11px]">
                        <div className="flex justify-between gap-2">
                          <span className="font-mono font-semibold text-[#2563EB]">{ev.action}</span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(ev.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[#334155]">{ev.details}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // Selectable Directory & Filters View
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search operator name or employee ID…"
          className="w-full rounded-lg border border-[#DCE6F2] bg-white py-2 pl-8 pr-3 text-xs text-[#14213D] placeholder:text-slate-400 focus:border-[#2563EB] focus:outline-none"
        />
      </div>

      {showDirectoryFilters && (
        <div className="grid grid-cols-2 gap-2">
          {!lockedFactoryId && (
            <>
              <select
                aria-label="Filter personnel by region"
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  setFactoryFilter("");
                  setMachineFilter("");
                }}
                className="rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#14213D]"
              >
                <option value="">All Regions</option>
                {(hierarchy?.regions ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter personnel by factory"
                value={factoryFilter}
                onChange={(e) => {
                  setFactoryFilter(e.target.value);
                  setMachineFilter("");
                }}
                className="rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#14213D]"
              >
                <option value="">All Factories</option>
                {factoriesInScope.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <select
            aria-label="Filter personnel by assigned machine"
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className="rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#14213D]"
          >
            <option value="">All Assigned Machines</option>
            {machinesInScope.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter personnel by role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs text-[#14213D]"
          >
            <option value="">All Roles</option>
            <option value="operator">Operator</option>
            <option value="maintenance_engineer">Maintenance Engineer</option>
            <option value="factory_supervisor">Factory Supervisor</option>
            <option value="regional_manager">Regional Manager</option>
            <option value="company_admin">Company Admin</option>
          </select>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Filter className="h-3 w-3 text-[#2563EB]" />
          Select one person to inspect individual details
        </span>
        <span className="font-mono font-semibold text-[#14213D]">{list.length} found</span>
      </div>

      {listError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {listError}
        </div>
      )}

      {listLoading ? (
        <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-4 text-center text-xs text-slate-500">
          Loading authorized personnel…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-[#DCE6F2] bg-[#F1F6FD] p-4 text-center text-xs text-slate-500">
          No authorized operators or users match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onSelectUser(u.id)}
              className="flex w-full items-start justify-between gap-2 rounded-xl border border-[#DCE6F2] bg-white p-3 text-left transition hover:border-[#2563EB] hover:bg-[#F1F6FD]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-[#14213D]">{u.name}</span>
                  {u.employee_id && (
                    <span className="rounded bg-[#EAF2FC] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#2563EB]">
                      {u.employee_id}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-[#334155]">
                  {ROLE_LABELS[u.role] ?? u.role}
                  {u.assigned_factory_name ? ` • ${u.assigned_factory_name}` : ""}
                </div>
                {u.assigned_machines.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {u.assigned_machines.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded border border-[#DCE6F2] bg-[#F1F6FD] px-1.5 py-0.5 font-mono text-[10px] text-[#14213D]"
                      >
                        <Cpu className="h-2.5 w-2.5 text-[#2563EB]" />
                        {m.code}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    u.assignment_status === "Active"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {u.assignment_status}
                </span>
                {u.current_shift && (
                  <div className="mt-1 text-[10px] text-slate-500">{u.current_shift}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
