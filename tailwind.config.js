/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: "0 24px 90px rgba(15, 23, 42, 0.14)",
        panel: "0 24px 80px rgba(15, 23, 42, 0.10)",
      },
      keyframes: {
        "soft-pulse": {
          "0%, 100%": { opacity: "0.66", transform: "scaleY(1)" },
          "50%": { opacity: "1", transform: "scaleY(1.05)" },
        },
        sweep: {
          "0%": { transform: "translateX(-18%)" },
          "100%": { transform: "translateX(18%)" },
        },
        aurora: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(60px, 40px) scale(1.15)" },
        },
        "aurora-reverse": {
          "0%, 100%": { transform: "translate(0, 0) scale(1.1)" },
          "50%": { transform: "translate(-70px, -30px) scale(0.95)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.5" },
          "50%": { transform: "scale(1.06)", opacity: "0.9" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "ambient-drift": {
          "0%, 100%": { transform: "scale(1.05) translate(0,0)", opacity: "0.55" },
          "50%": { transform: "scale(1.2) translate(2%, -3%)", opacity: "0.8" },
        },
      },
      animation: {
        "soft-pulse": "soft-pulse 3s ease-in-out infinite",
        sweep: "sweep 7s ease-in-out infinite alternate",
        aurora: "aurora 20s ease-in-out infinite",
        "aurora-slow": "aurora-reverse 30s ease-in-out infinite",
        breathe: "breathe 4s ease-in-out infinite",
        "fade-in": "fade-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "ambient-drift": "ambient-drift 14s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
