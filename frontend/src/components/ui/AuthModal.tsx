import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck, X } from "lucide-react";
import { useTwinStore } from "../../store/twinStore";

const DEMO_ACCOUNTS = [
  {
    label: "Incoming Operator (M. Priya)",
    role: "operator",
    email: "operator@example.com",
    pwd: "operator123",
  },
  {
    label: "Outgoing Operator (K. Aravind)",
    role: "operator",
    email: "john@example.com",
    pwd: "employee123",
  },
  {
    label: "Factory Supervisor (S. Karthik)",
    role: "factory_supervisor",
    email: "supervisor@example.com",
    pwd: "supervisor123",
  },
  {
    label: "Regional Manager (V. Lakshmi)",
    role: "regional_manager",
    email: "regional@example.com",
    pwd: "regional123",
  },
  {
    label: "Maintenance Engineer (D. Ramesh)",
    role: "maintenance_engineer",
    email: "maintenance@example.com",
    pwd: "maint123",
  },
  {
    label: "Company Admin (R. Sundaram)",
    role: "company_admin",
    email: "admin@example.com",
    pwd: "admin123",
  },
];

export const AuthModal: React.FC = () => {
  const { authModalOpen, setAuthModalOpen, loginUser } = useTwinStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState("operator@example.com");
  const [password, setPassword] = useState("operator123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!authModalOpen) return null;

  const submit = async (em: string, pw: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const user = await loginUser(em, pw);
      if (user.role === "operator") {
        navigate("/digital-twin/operator");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14213D]/30 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            <h2 className="text-sm font-bold text-slate-900">PS-032 Factory Personnel Sign-In</h2>
          </div>
          <button
            type="button"
            onClick={() => setAuthModalOpen(false)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(email, password);
          }}
          className="space-y-3 p-5"
        >
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700">Personnel Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {submitting ? "Authenticating…" : "Sign In"}
          </button>

          <div className="border-t border-slate-200 pt-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Quick Role Switch (Demo Accounts)
            </div>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  disabled={submitting}
                  onClick={() => submit(acc.email, acc.pwd)}
                  className="flex w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs hover:border-blue-500 hover:bg-blue-50"
                >
                  <span className="font-medium text-slate-800">{acc.label}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {acc.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

