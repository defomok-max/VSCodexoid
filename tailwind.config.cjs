/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/webview/**/*.{ts,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        nexus: {
          bg: "var(--nexus-bg)",
          surface: "var(--nexus-surface)",
          "surface-2": "var(--nexus-surface-2)",
          border: "var(--nexus-border)",
          text: "var(--nexus-text)",
          muted: "var(--nexus-muted)",
          accent: "var(--nexus-accent)",
          "accent-hover": "var(--nexus-accent-hover)",
          danger: "var(--nexus-danger)",
          warn: "var(--nexus-warn)",
          ok: "var(--nexus-ok)",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Inter",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace",
        ],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)",
      },
      animation: {
        fadeIn: "fadeIn 200ms ease-out",
        slideUp: "slideUp 220ms ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
