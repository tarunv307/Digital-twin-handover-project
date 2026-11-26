import React from "react";

interface Props {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, errorMessage: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">3D Viewport Unavailable</p>
          <p className="mt-1 text-xs text-slate-500">
            Switched to safe display mode ({this.state.errorMessage}).
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

