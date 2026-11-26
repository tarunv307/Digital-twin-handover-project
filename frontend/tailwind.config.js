/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        app: "var(--bg-app)",
        surface: "var(--bg-surface)",
        secondary: "var(--bg-secondary)",
        brand: {
          DEFAULT: "var(--brand-primary)",
          hover: "var(--brand-primary-hover)",
        },
        navy: "var(--text-heading)",
        line: "var(--border-subtle)",
        icehover: "var(--bg-hover)",
        iceselected: "var(--bg-selected)",
        slate: {
          50: "#EAF2FC",
          100: "#F1F6FD",
          200: "#DCE6F2",
          300: "#C5D5E9",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#14213D",
          950: "#0F172A",
        },
        blue: {
          50: "#EAF2FC",
          100: "#DBEAFE",
          200: "#C7DDFB",
          300: "#93C5FD",
          400: "#60A5FA",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#2563EB",
          800: "#1D4ED8",
          900: "#14213D",
        },
      },
    },
  },
  plugins: [],
};
