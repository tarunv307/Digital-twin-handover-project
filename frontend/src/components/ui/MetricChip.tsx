import React from "react";

export const MetricChip: React.FC<{
  label: string;
  value: string | number;
  unit?: string;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}> = ({ label, value, unit, tone = "default" }) => {
  const toneClass =
    tone === "success"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "danger"
          ? "text-red-700"
          : tone === "accent"
            ? "text-blue-700"
            : "text-slate-900";

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
      </div>
    </div>
  );
};

