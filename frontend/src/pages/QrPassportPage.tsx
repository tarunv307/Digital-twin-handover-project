import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Cpu,
  HeartPulse,
  Lock,
  LogIn,
  Printer,
  QrCode,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { StatusBadge } from "../components/ui/StatusBadge";
import { digitalTwinApi } from "../services/api";
import { useTwinStore } from "../store/twinStore";
import type { QrPassportData } from "../types/digitalTwin";

const QrMatrixSvg: React.FC<{ value: string }> = ({ value }) => {
  // Deterministic crisp visual 21x21 QR matrix for display & printing
  const size = 21;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const cells: React.ReactElement[] = [];
  const isFinder = (r: number, c: number) => {
    const inBox = (br: number, bc: number) => {
      const dr = r - br;
      const dc = c - bc;
      if (dr < 0 || dc < 0 || dr > 6 || dc > 6) return false;
      return dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
    };
    return inBox(0, 0) || inBox(0, size - 7) || inBox(size - 7, 0);
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinderCorner = (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
      const dark = inFinderCorner ? isFinder(r, c) : ((hash ^ (r * 31 + c * 17)) & 1) === 1;
      if (dark) {
        cells.push(<rect key={`${r}-${c}`} x={c * 4 + 4} y={r * 4 + 4} width="4" height="4" fill="#0f172a" />);
      }
    }
  }
  return (
    <svg viewBox="0 0 92 92" className="h-24 w-24 rounded border border-slate-300 bg-white p-1">
      {cells}
    </svg>
  );
};

export const QrPassportPage: React.FC = () => {
  const { qrToken } = useParams<{ qrToken: string }>();
  const { currentUser, setAuthModalOpen } = useTwinStore();
  const [data, setData] = useState<QrPassportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!qrToken || !currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await digitalTwinApi.getQrPassport(qrToken);
      setData(res);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [qrToken, currentUser]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell
      breadcrumbs={[
        { label: "Company", to: "/digital-twin" },
        { label: `QR Passport (${qrToken})` },
      ]}
      title="PS-032 QR Machine Passport"
      subtitle={`Digital Asset Token: ${qrToken}`}
      showOverviewToggle={false}
      actions={
        data && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" /> Print Passport
          </button>
        )
      }
    >
      <div className="h-full overflow-y-auto p-5">
        {!currentUser ? (
          <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
            <QrCode className="mx-auto h-10 w-10 text-blue-700" />
            <h2 className="mt-3 text-sm font-bold text-slate-900">Sign In to Scan Machine Passport</h2>
            <p className="mt-1 text-xs text-slate-500">
              QR machine passports verify your station/shift authorization before displaying live operational controls.
            </p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white"
            >
              <LogIn className="h-4 w-4" /> Sign In
            </button>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-center text-xs text-red-900">
            <Lock className="mx-auto h-9 w-9 text-red-600" />
            <h2 className="mt-2 text-sm font-bold">Machine Access Denied (403)</h2>
            <p className="mt-1">{error}</p>
            <Link
              to="/digital-twin/operator"
              className="mt-4 inline-flex items-center gap-1.5 rounded bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]"
            >
              Return to My Assigned Machines
            </Link>
          </div>
        ) : loading || !data ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Loading QR Machine Passport…
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            {/* Identity Card */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-4">
                <QrMatrixSvg value={data.machine.qr_token} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-700 px-2 py-0.5 font-mono text-xs font-bold text-white">
                      {data.machine.code}
                    </span>
                    <span className="font-mono text-xs text-slate-500">QR: {data.machine.qr_token}</span>
                    {data.state && <StatusBadge status={data.state.status} />}
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">{data.machine.name}</h2>
                  <p className="text-xs text-slate-600">
                    {data.machine.region_name} → {data.machine.factory_name} → {data.machine.line_name}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <Link
                  to={`/digital-twin/machine/${data.machine.id}`}
                  className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Open Live Digital Twin & Workspace <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to={`/digital-twin/machine/${data.machine.id}/handover`}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Open Shift Handover Record
                </Link>
              </div>
            </div>

            {/* Health, Energy, Safety, Production */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-700">
                  <HeartPulse className="h-4 w-4 text-rose-600" />
                  Health Score (Estimated)
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-bold text-slate-900">{data.health.score}</span>
                  <span className="text-xs font-semibold text-slate-600">/ 100 • {data.health.category}</span>
                </div>
                <p className="mt-1 text-[10px] text-slate-500">{data.health.disclaimer}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-700">
                  <Zap className="h-4 w-4 text-amber-600" />
                  Energy ({data.energy.is_simulated ? "Simulated" : "Sensor"})
                </div>
                <div className="mt-2 font-mono text-2xl font-bold text-slate-900">{data.energy.current_kw} kW</div>
                <div className="mt-1 text-[11px] text-slate-600">
                  Est. Shift: {data.energy.estimated_shift_kwh} kWh • {data.energy.kwh_per_unit} kWh/unit
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-700">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Safety & Production Summary
                </div>
                <div className="mt-2 text-xs text-slate-800">
                  Safety Check:{" "}
                  <strong className="uppercase">{data.safety_checklist_status?.overall_status ?? "Pending"}</strong>
                </div>
                <div className="mt-1 font-mono text-xs text-slate-600">
                  Recent Units: {data.production_summary.good_units} good / {data.production_summary.total_rejects} rej
                </div>
                {data.current_handover && (
                  <div className="mt-1 text-[11px] text-slate-600">
                    Handover {data.current_handover.id}: <strong>{data.current_handover.status}</strong>
                  </div>
                )}
              </div>
            </div>

            {/* Specs, Abnormalities & Maintenance */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700">
                  <Cpu className="h-4 w-4" /> Technical Specs
                </div>
                <div className="space-y-1 text-xs">
                  <div>Manufacturer: {data.specification?.manufacturer ?? "—"}</div>
                  <div>Model: {data.specification?.model ?? "—"}</div>
                  <div>Serial: {data.specification?.serial_number ?? "—"}</div>
                  <div>Last Maint: {data.specification?.last_maintenance_date ?? "—"}</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700">
                  <AlertTriangle className="h-4 w-4 text-red-600" /> Recent Abnormalities
                </div>
                {data.recent_abnormalities.length === 0 ? (
                  <div className="text-xs text-slate-400">None recorded.</div>
                ) : (
                  <div className="space-y-1.5 text-xs">
                    {data.recent_abnormalities.map((a) => (
                      <div key={a.id} className="rounded bg-slate-50 p-2">
                        <span className="font-mono font-bold">{a.code}</span> • {a.title} ({a.status})
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700">
                  <Wrench className="h-4 w-4 text-sky-600" /> Maintenance History
                </div>
                {data.maintenance_history.length === 0 ? (
                  <div className="text-xs text-slate-400">No service logs yet.</div>
                ) : (
                  <div className="space-y-1.5 text-xs">
                    {data.maintenance_history.map((m) => (
                      <div key={m.id} className="rounded bg-slate-50 p-2">
                        <span className="font-semibold uppercase">{m.type}</span> • {m.summary} ({m.status})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded border border-slate-200 bg-white px-4 py-2.5 text-[11px] text-slate-500">
              <Activity className="h-3.5 w-3.5 text-blue-700" />
              QR Machine Passport served directly from PS-032 PostgreSQL/SQLite persistence layer.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
};
