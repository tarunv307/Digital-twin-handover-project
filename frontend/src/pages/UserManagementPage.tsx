import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  History,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { OperatorProfilePanel } from "../components/ui/OperatorProfilePanel";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type {
  CompanyOverview,
  FactorySummary,
  OperatorAssignment,
  RegionDetail,
  UserAccount,
} from "../types/digitalTwin";

interface MachineOption {
  id: string;
  code: string;
  name: string;
  line_id: string;
  line_name: string;
  factory_id: string;
  factory_name: string;
}

export const UserManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, triggerStructuralRefresh } = useTwinStore();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [assignments, setAssignments] = useState<OperatorAssignment[]>([]);
  const [company, setCompany] = useState<CompanyOverview | null>(null);
  const [machineOptions, setMachineOptions] = useState<MachineOption[]>([]);

  const [searchQ, setSearchQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Create User form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmpId, setNewEmpId] = useState("");
  const [newPassword, setNewPassword] = useState("pass1234");
  const [newRole, setNewRole] = useState("operator");
  const [newRegionId, setNewRegionId] = useState("");
  const [newFactoryId, setNewFactoryId] = useState("");

  // Assignment form
  const [assignUserId, setAssignUserId] = useState<string>("");
  const [assignMachineId, setAssignMachineId] = useState<string>("");
  const [assignShiftName, setAssignShiftName] = useState("Morning Shift");
  const [assignStartDate, setAssignStartDate] = useState("");
  const [assignEndDate, setAssignEndDate] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  // Individual user profile drawer
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<number | null>(null);

  const isSupervisory =
    currentUser && ["company_admin", "regional_manager", "factory_supervisor"].includes(currentUser.role);

  const loadAll = useCallback(async () => {
    if (!isSupervisory) return;
    try {
      const [uList, aList, comp] = await Promise.all([
        digitalTwinApi.listUsers({
          q: searchQ || undefined,
          role: roleFilter || undefined,
          is_active: activeFilter === "" ? undefined : activeFilter === "true",
        }),
        digitalTwinApi.listAssignments(),
        digitalTwinApi.getCompanyOverview(),
      ]);
      setUsers(uList);
      setAssignments(aList);
      setCompany(comp);

      // Load factories and their machines for assignment dropdown
      const facIds: string[] = [];
      comp.regions.forEach((r: RegionDetail) => r.factories.forEach((f: FactorySummary) => facIds.push(f.id)));
      const facDetails = await Promise.all(
        facIds.map((fid) => digitalTwinApi.getFactoryDetail(fid).catch(() => null))
      );
      const opts: MachineOption[] = [];
      facDetails.forEach((fd) => {
        if (!fd) return;
        fd.production_lines.forEach((line) => {
          line.machines.forEach((m) => {
            opts.push({
              id: m.id,
              code: m.code,
              name: m.name,
              line_id: line.id,
              line_name: line.name,
              factory_id: fd.id,
              factory_name: fd.name,
            });
          });
        });
      });
      setMachineOptions(opts);
      if (!assignMachineId && opts.length > 0) setAssignMachineId(opts[0].id);
      if (!assignUserId && uList.length > 0) {
        const firstOp = uList.find((u) => u.role === "operator") ?? uList[0];
        setAssignUserId(String(firstOp.id));
      }
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    }
  }, [isSupervisory, searchQ, roleFilter, activeFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await digitalTwinApi.createUser({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
        employee_id: newEmpId || undefined,
        assigned_region_id: newRegionId || undefined,
        assigned_factory_id: newFactoryId || undefined,
      });
      setNewName("");
      setNewEmail("");
      setNewEmpId("");
      setNotice({ type: "ok", text: "User account created and recorded in audit trail." });
      await loadAll();
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignUserId || !assignMachineId) return;
    setBusy(true);
    setNotice(null);
    try {
      await digitalTwinApi.createAssignment({
        user_id: Number(assignUserId),
        machine_id: assignMachineId,
        shift_name: assignShiftName,
        start_date: assignStartDate || undefined,
        end_date: assignEndDate || undefined,
        notes: assignNotes || undefined,
      });
      setAssignNotes("");
      setNotice({ type: "ok", text: "Machine & shift assignment created." });
      triggerStructuralRefresh();
      await loadAll();
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleUserActive = async (u: UserAccount) => {
    setBusy(true);
    try {
      await digitalTwinApi.updateUser(u.id, { is_active: !u.is_active });
      setNotice({ type: "ok", text: `${u.name} marked ${!u.is_active ? "Active" : "Inactive"}.` });
      await loadAll();
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: UserAccount) => {
    const nextPwd = window.prompt(`Enter new password for ${u.email}:`, "reset1234");
    if (!nextPwd) return;
    setBusy(true);
    try {
      await digitalTwinApi.updateUser(u.id, { password: nextPwd });
      setNotice({ type: "ok", text: `Password reset for ${u.email}.` });
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleAssignment = async (a: OperatorAssignment) => {
    setBusy(true);
    try {
      if (a.is_active) {
        await digitalTwinApi.deleteAssignment(a.id);
      } else {
        await digitalTwinApi.updateAssignment(a.id, { is_active: true });
      }
      setNotice({ type: "ok", text: `Assignment #${a.id} updated.` });
      triggerStructuralRefresh();
      await loadAll();
    } catch (err) {
      setNotice({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const openHistory = (userId: number) => {
    setSelectedProfileUserId(userId);
  };

  const allFactories: FactorySummary[] = [];
  company?.regions.forEach((r) => r.factories.forEach((f) => allFactories.push(f)));

  return (
    <AppShell
      breadcrumbs={[
        { label: "Company", to: "/digital-twin" },
        { label: "Users & Machine Assignments" },
      ]}
      title="User Administration & Operator-Machine Access Control"
      subtitle="Manage accounts, credentials, organizational scope, and normalized machine/shift assignments"
      showOverviewToggle={false}
      actions={
        <button
          type="button"
          onClick={loadAll}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      }
    >
      <div className="h-full overflow-y-auto p-5">
        {!isSupervisory ? (
          <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center text-xs text-red-900">
            <ShieldAlert className="mx-auto h-9 w-9 text-red-600" />
            <h2 className="mt-2 text-sm font-bold">Supervisory Access Required</h2>
            <p className="mt-1">
              User management and machine-to-operator assignments are restricted to Company Admin, Regional Manager, and
              Factory Supervisor roles.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-5">
            {notice && (
              <div
                className={`rounded border px-4 py-2.5 text-xs font-medium ${
                  notice.type === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {notice.text}
              </div>
            )}

            {/* Creation Grid */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Create User Form */}
              <form onSubmit={handleCreateUser} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                  <UserPlus className="h-4 w-4 text-blue-700" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">Create Industrial User</h2>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <input
                    required
                    placeholder="Full Name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    required
                    type="email"
                    placeholder="Work Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    placeholder="Employee ID (e.g. OP-204)"
                    value={newEmpId}
                    onChange={(e) => setNewEmpId(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
                  />
                  <input
                    required
                    type="password"
                    placeholder="Initial Password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="operator">Operator</option>
                    <option value="maintenance_engineer">Maintenance Engineer</option>
                    {currentUser?.role !== "factory_supervisor" && (
                      <option value="factory_supervisor">Factory Supervisor</option>
                    )}
                    {currentUser?.role === "company_admin" && (
                      <>
                        <option value="regional_manager">Regional Manager</option>
                        <option value="company_admin">Company Admin</option>
                      </>
                    )}
                  </select>
                  <select
                    value={newFactoryId}
                    onChange={(e) => setNewFactoryId(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Factory Scope (Default / Auto)</option>
                    {allFactories.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newRegionId}
                    onChange={(e) => setNewRegionId(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs sm:col-span-2"
                  >
                    <option value="">Region Scope (Default / Auto)</option>
                    {company?.regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Create User Account
                </button>
              </form>

              {/* Assign Operator/Engineer to Machine & Shift */}
              <form
                onSubmit={handleCreateAssignment}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs"
              >
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                  <Link2 className="h-4 w-4 text-emerald-700" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Assign Personnel to Machine & Shift
                  </h2>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <select
                    required
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <select
                    required
                    value={assignMachineId}
                    onChange={(e) => setAssignMachineId(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    {machineOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name} ({m.factory_id})
                      </option>
                    ))}
                  </select>
                  <select
                    value={assignShiftName}
                    onChange={(e) => setAssignShiftName(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="Morning Shift">Morning Shift</option>
                    <option value="Evening Shift">Evening Shift</option>
                    <option value="Night Shift">Night Shift</option>
                    <option value="Frühschicht (Morning)">Frühschicht (Morning)</option>
                    <option value="Nachtschicht (Night)">Nachtschicht (Night)</option>
                  </select>
                  <input
                    placeholder="Notes (optional)"
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={assignStartDate}
                    onChange={(e) => setAssignStartDate(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                    title="Start Date"
                  />
                  <input
                    type="date"
                    value={assignEndDate}
                    onChange={(e) => setAssignEndDate(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                    title="End Date"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-3 inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Assign Machine & Shift
                </button>
              </form>
            </div>

            {/* Personnel Directory */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-slate-700" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Personnel Directory ({users.length})
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    placeholder="Search name / ID / email…"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs"
                  />
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">All Roles</option>
                    <option value="operator">Operator</option>
                    <option value="maintenance_engineer">Maintenance Engineer</option>
                    <option value="factory_supervisor">Factory Supervisor</option>
                    <option value="regional_manager">Regional Manager</option>
                    <option value="company_admin">Company Admin</option>
                  </select>
                  <select
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value as "" | "true" | "false")}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    <option value="">All Status</option>
                    <option value="true">Active Only</option>
                    <option value="false">Inactive Only</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Org Scope</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{u.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {u.email} {u.employee_id ? `• ${u.employee_id}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">{u.role}</td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {u.assigned_factory_id || u.assigned_region_id || "Company-Wide"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              u.is_active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {u.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openHistory(u.id)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-100"
                              title="History"
                            >
                              <History className="inline h-3 w-3" /> History
                            </button>
                            <button
                              type="button"
                              onClick={() => resetPassword(u)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-100"
                              title="Reset Password"
                            >
                              <KeyRound className="inline h-3 w-3" /> Reset
                            </button>
                            <button
                              type="button"
                              disabled={busy || u.id === currentUser?.id}
                              onClick={() => toggleUserActive(u)}
                              className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-100 disabled:opacity-40"
                            >
                              {u.is_active ? "Deactivate" : "Activate"}
                            </button>
                            {currentUser?.role === "company_admin" && u.id !== currentUser.id && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm(`Delete user ${u.email}?`)) return;
                                  await digitalTwinApi.deleteUser(u.id);
                                  await loadAll();
                                }}
                                className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                                title="Delete User (Admin Only)"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Normalized Operator-Machine Assignment Table */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-800">
                Active & Historical Machine Assignments ({assignments.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Personnel</th>
                      <th className="px-3 py-2">Machine / Scope</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2">Assigned By</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assignments.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-900">{a.user_name ?? `User #${a.user_id}`}</span>{" "}
                          <span className="font-mono text-[10px] text-slate-500">({a.user_role})</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px]">
                          {a.machine_code ?? a.machine_id ?? a.line_id ?? a.factory_id}
                        </td>
                        <td className="px-3 py-2">{a.shift_name ?? "All Shifts"}</td>
                        <td className="px-3 py-2 text-slate-500">{a.assigned_by_name ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              a.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {a.is_active ? "ACTIVE" : "REVOKED"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleAssignment(a)}
                            className={`rounded border px-2 py-1 text-[11px] font-medium ${
                              a.is_active
                                ? "border-red-200 text-red-700 hover:bg-red-50"
                                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            {a.is_active ? "Revoke Access" : "Re-activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Individual Operator Profile Drawer */}
        {selectedProfileUserId !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-[#14213D]/30 backdrop-blur-xs">
            <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-[#DCE6F2] px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-bold text-[#14213D]">Individual Personnel Profile</h3>
                  <p className="text-[11px] text-slate-500">Assigned equipment, reports, abnormalities & handovers</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProfileUserId(null)}
                  className="rounded p-1 hover:bg-[#EAF2FC]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <OperatorProfilePanel
                  hierarchy={null}
                  selectedUserId={selectedProfileUserId}
                  onSelectUser={(uid) => setSelectedProfileUserId(uid)}
                  onSelectMachine={(mid) => navigate(`/digital-twin/machine/${mid}`)}
                  onSelectFactory={(fid) => navigate(`/digital-twin/factory/${fid}`)}
                  onBack={() => setSelectedProfileUserId(null)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
