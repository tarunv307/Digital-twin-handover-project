import React from "react";
import type { MachineStatus } from "../../types/digitalTwin";

export const STATUS_COLORS: Record<
  MachineStatus,
  { bg: string; text: string; border: string; dot: string; hex: string }
> = {
  Running: {
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
    dot: "bg-emerald-600",
    hex: "#16a34a",
  },
  Idle: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
    hex: "#d97706",
  },
  Stopped: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-300",
    dot: "bg-slate-500",
    hex: "#64748b",
  },
  Fault: {
    bg: "bg-red-50",
    text: "text-red-800",
    border: "border-red-200",
    dot: "bg-red-600",
    hex: "#dc2626",
  },
  Maintenance: {
    bg: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
    dot: "bg-sky-600",
    hex: "#0284c7",
  },
  Offline: {
    bg: "bg-[#EAF2FC]",
    text: "text-[#334155]",
    border: "border-[#DCE6F2]",
    dot: "bg-[#64748B]",
    hex: "#64748B",
  },
  Unknown: {
    bg: "bg-[#EAF2FC]",
    text: "text-[#64748B]",
    border: "border-[#DCE6F2]",
    dot: "bg-[#94A3B8]",
    hex: "#94A3B8",
  },
};

export const StatusBadge: React.FC<{ status?: MachineStatus | string | null; size?: "sm" | "md" }> = ({
  status,
  size = "md",
}) => {
  const normalized = (status && status in STATUS_COLORS ? status : "Unknown") as MachineStatus;
  const style = STATUS_COLORS[normalized];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border font-medium ${style.bg} ${style.text} ${style.border} ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot} ${normalized === "Fault" ? "animate-pulse" : ""}`} />
      {normalized}
    </span>
  );
};

