import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Building2, Home } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export const Breadcrumbs: React.FC<{ items: BreadcrumbItem[] }> = ({ items }) => {
  return (
    <nav aria-label="Digital Twin Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs">
      <Link
        to="/"
        className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-blue-700"
        title="Apex Precision Manufacturing Home"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Portal</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
      <Link
        to="/digital-twin"
        className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-blue-700"
      >
        <Building2 className="h-3.5 w-3.5 text-blue-700" />
        <span>Company</span>
      </Link>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="rounded px-2 py-1 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-blue-700"
              >
                {item.label}
              </Link>
            ) : (
              <span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-900">
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

