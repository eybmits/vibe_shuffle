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
      keyframes: {
        "soft-pulse": {
          "0%, 100%": { opacity: "0.66", transform: "scaleY(1)" },
          "50%": { opacity: "1", transform: "scaleY(1.05)" },
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
        "highlight-wipe": {
          "0%": { transform: "scaleX(0)", opacity: "0" },
          "100%": { transform: "scaleX(1)", opacity: "1" },
        },
        "word-in": {
          "0%": { opacity: "0", transform: "translateY(0.45em)", filter: "blur(10px)" },
          "60%": { opacity: "1", filter: "blur(0)" },
          "100%": { opacity: "1", transform: "translateY(0)", filter: "blur(0)" },
        },
      },
      animation: {
        "soft-pulse": "soft-pulse 3s ease-in-out infinite",
        aurora: "aurora 20s ease-in-out infinite",
        "aurora-slow": "aurora-reverse 30s ease-in-out infinite",
        breathe: "breathe 4s ease-in-out infinite",
        "fade-in": "fade-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "ambient-drift": "ambient-drift 14s ease-in-out infinite",
        "highlight-wipe": "highlight-wipe 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "word-in": "word-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
