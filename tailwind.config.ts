import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        surface: {
          DEFAULT: "var(--surface)",
          alt: "var(--surface-2)",
        },
        ink: {
          1: "var(--text-1)",
          2: "var(--text-2)",
          3: "var(--text-3)",
        },
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-2)",
        },
        // Accents (TradingView-inspired)
        accent: {
          DEFAULT: "var(--accent)",
          bg: "var(--accent-bg)",
          border: "var(--accent-border)",
        },
        profit: {
          DEFAULT: "var(--green)",
          bg: "var(--green-bg)",
        },
        loss: {
          DEFAULT: "var(--red)",
          bg: "var(--red-bg)",
        },
        indicator: {
          DEFAULT: "var(--purple)",
          bg: "var(--purple-bg)",
        },
        warn: {
          DEFAULT: "var(--amber)",
          bg: "var(--amber-bg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-dm-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.04)",
        "card-hover": "0 3px 12px rgba(41,98,255,0.09)",
        float: "0 8px 32px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.05)",
      },
      animation: {
        "fade-in": "fadeIn 0.15s ease",
        "soft-pulse": "softPulse 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        softPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
