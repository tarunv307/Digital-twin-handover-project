import React, { useState } from "react";
import { Clock, Edit3, Check, X } from "lucide-react";
import { digitalTwinApi } from "../../services/api";
import type { ShiftContext, ShiftWindow } from "../../types/digitalTwin";

interface ShiftSchedulePanelProps {
  shiftContext: ShiftContext;
  onUpdated?: () => void;
}

export const ShiftSchedulePanel: React.FC<ShiftSchedulePanelProps> = ({ shiftContext, onUpdated }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start_time: string; end_time: string; supervisor: string }>({
    start_time: "",
    end_time: "",
    supervisor: "",
  });
  const [saving, setSaving] = useState(false);

  const startEdit = (sw: ShiftWindow) => {
    setEditingId(sw.schedule_id);
    setDraft({
      start_time: sw.start_time,
      end_time: sw.end_time,
      supervisor: sw.supervisor ?? "",
    });
  };

  const saveEdit = async (scheduleId: string) => {
    setSaving(true);
    try {
      await digitalTwinApi.updateShiftSchedule(scheduleId, {
        start_time: draft.start_time,
        end_time: draft.end_time,
        supervisor: draft.supervisor || undefined,
      });
      setEditingId(null);
      onUpdated?.();
    } finally {
      setSaving(false);
    }
  };

  const localTimeStr = new Date(shiftContext.local_time_iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: shiftContext.timezone,
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-700" />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Regional Shift Schedule
            </h3>
            <p className="font-mono text-[11px] text-slate-500">
              {shiftContext.timezone} • Local {localTimeStr}
            </p>
          </div>
        </div>
        {shiftContext.minutes_to_transition !== null && (
          <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-800">
            Transition in {shiftContext.minutes_to_transition}m
          </span>
        )}
      </div>

      {/* Active / Previous / Upcoming summary */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] font-medium uppercase text-slate-500">Previous</div>
          <div className="mt-0.5 truncate font-semibold text-slate-800">
            {shiftContext.previous_shift?.shift_name ?? "Not configured"}
          </div>
        </div>
        <div className="rounded border border-blue-200 bg-blue-50/70 p-2">
          <div className="text-[10px] font-medium uppercase text-blue-700">Active Shift</div>
          <div className="mt-0.5 truncate font-bold text-blue-900">
            {shiftContext.current_shift?.shift_name ?? "Outside window"}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] font-medium uppercase text-slate-500">Upcoming</div>
          <div className="mt-0.5 truncate font-semibold text-slate-800">
            {shiftContext.upcoming_shift?.shift_name ?? "Not configured"}
          </div>
        </div>
      </div>

      {/* Configurable shift table */}
      <div className="mt-3 space-y-2">
        {shiftContext.schedules.map((sw) => {
          const isCurrent = shiftContext.current_shift?.schedule_id === sw.schedule_id;
          const isEditing = editingId === sw.schedule_id;
          return (
            <div
              key={sw.schedule_id}
              className={`rounded border p-2 text-xs ${
                isCurrent ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-900">{sw.shift_name}</span>
                  {sw.crosses_midnight && (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                      +1d Midnight
                    </span>
                  )}
                </div>
                {!isEditing ? (
                  <button
                    type="button"
                    onClick={() => startEdit(sw)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveEdit(sw.schedule_id)}
                      className="rounded bg-blue-700 p-1 text-white hover:bg-blue-800"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded border border-slate-300 p-1 text-slate-600 hover:bg-slate-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <input
                    type="text"
                    value={draft.start_time}
                    onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                    placeholder="HH:MM"
                    className="rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
                  />
                  <input
                    type="text"
                    value={draft.end_time}
                    onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                    placeholder="HH:MM"
                    className="rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
                  />
                  <input
                    type="text"
                    value={draft.supervisor}
                    onChange={(e) => setDraft({ ...draft, supervisor: e.target.value })}
                    placeholder="Supervisor"
                    className="rounded border border-slate-300 px-1.5 py-1 text-[11px]"
                  />
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span className="font-mono">
                    {sw.start_time} – {sw.end_time} ({sw.duration_hours}h)
                  </span>
                  <span>Sup: {sw.supervisor ?? "Not configured"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

